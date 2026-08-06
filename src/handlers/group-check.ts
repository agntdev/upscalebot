import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { getUser, saveUser, settings } from "../domain-store.js";

registerMainMenuItem({ label: "Check membership", data: "group:check", order: 40 });

const composer = new Composer<Ctx>();
const retryKeyboard = inlineKeyboard([
  [inlineButton("Check membership", "group:check")],
  [inlineButton("Back to menu", "menu:main")],
]);

type TelegramFailure = {
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
};

function resolveChatId(value: string): string {
  const group = value.trim();
  if (/^-?\d+$/.test(group) || group.startsWith("@")) return group;
  const match = group.match(/^https:\/\/t\.me\/([A-Za-z0-9_]{5,})\/?(?:\?.*)?$/);
  return match ? `@${match[1]}` : group;
}

function telegramFailure(error: unknown): TelegramFailure {
  const candidate = error as TelegramFailure & { message?: string };
  return {
    error_code: candidate?.error_code,
    description: candidate?.description ?? candidate?.message,
    parameters: candidate?.parameters,
  };
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function checkMember(ctx: Ctx, chatId: string, userId: number) {
  try {
    return await ctx.api.getChatMember(chatId, userId);
  } catch (firstError) {
    const failure = telegramFailure(firstError);
    const retryAfter = failure.parameters?.retry_after;
    const transient = failure.error_code === 429 || failure.error_code === undefined || failure.error_code >= 500;

    // A single short retry covers a momentary Telegram/API outage without
    // holding the update open for a long server-directed backoff.
    if (!transient || (retryAfter !== undefined && retryAfter > 2)) throw firstError;
    await wait(Math.max(250, (retryAfter ?? 0) * 1_000));
    return ctx.api.getChatMember(chatId, userId);
  }
}

function membershipErrorMessage(error: unknown): string {
  const failure = telegramFailure(error);
  const description = (failure.description ?? "").toLowerCase();
  const retryAfter = failure.parameters?.retry_after;

  if (failure.error_code === 429) {
    return retryAfter
      ? `Telegram asked us to wait ${retryAfter} seconds. Please try again shortly.`
      : "Telegram is busy right now. Please try again shortly.";
  }
  if (
    failure.error_code === 403 ||
    description.includes("chat not found") ||
    description.includes("not a member") ||
    description.includes("not enough rights") ||
    description.includes("forbidden")
  ) {
    return "Couldn’t verify membership because the bot needs group access. Ask the owner to add the bot and allow member checks.";
  }
  if (description.includes("user not found") || description.includes("participant_id_invalid")) {
    return "You’re not in the group yet. Join it, then check again.";
  }
  if (failure.error_code === undefined || failure.error_code >= 500) {
    return "Couldn’t verify membership right now. Please try again shortly.";
  }
  return "Couldn’t verify membership because Telegram rejected the group check. Ask the owner to review the group settings.";
}

function logMembershipFailure(error: unknown, chatId: string, userId: number): void {
  const failure = telegramFailure(error);
  const description = (failure.description ?? "").toLowerCase();
  const needsGroupAccess =
    failure.error_code === 403 ||
    description.includes("chat not found") ||
    description.includes("not enough rights") ||
    description.includes("forbidden");
  if (needsGroupAccess) {
    console.error("[membership check] Telegram could not check group access", {
      chatId,
      userId,
      errorCode: failure.error_code,
      description: failure.description,
    });
  } else {
    console.error("[membership check] Telegram membership request failed", {
      chatId,
      userId,
      errorCode: failure.error_code,
      description: failure.description,
    });
  }
}

composer.callbackQuery("group:check", async (ctx) => {
  await ctx.answerCallbackQuery();
  if (!ctx.from) return;

  const config = await settings(ctx);
  if (!config.groupChatId) {
    await ctx.reply("The membership group isn’t set up yet. Ask the owner to configure it.", {
      reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]),
    });
    return;
  }

  try {
    // Telegram requires the target group chat ID first and the requesting
    // Telegram user's ID second. The configured ID is stored as text so large
    // negative supergroup IDs are never truncated.
    const chatId = resolveChatId(config.groupChatId);
    const member = await checkMember(ctx, chatId, ctx.from.id);
    // A restricted chat member can remain in the group, but Telegram also uses
    // that status with is_member=false after they leave. Do not grant credits in
    // the latter case.
    const joined =
      ["creator", "administrator", "member"].includes(member.status) ||
      (member.status === "restricted" &&
        (typeof member.can_send_messages === "boolean"
          ? member.can_send_messages
          : member.is_member === true));
    if (!joined) {
      await ctx.reply("You’re not in the group yet. Join it, then check again.", {
        reply_markup: inlineKeyboard([
          [inlineButton("Join group", "group:join")],
          [inlineButton("Back to menu", "menu:main")],
        ]),
      });
      return;
    }

    const previous = await getUser(ctx, ctx.from.id);
    const saved = await saveUser(ctx, {
      telegramId: ctx.from.id,
      username: ctx.from.username,
      groupMember: true,
      tier: previous?.tier ?? "free",
      expiryDate: previous?.expiryDate,
      credits: previous?.groupMember ? previous.credits : Math.max(previous?.credits ?? 0, 1),
    });
    if (!saved) {
      await ctx.reply("Membership was confirmed, but credits aren’t set up yet. Please try again shortly.");
      return;
    }

    await ctx.reply(
      previous?.groupMember
        ? "Your group membership is confirmed."
        : "Your group membership is confirmed. One Standard credit is ready to use.",
      {
        reply_markup: inlineKeyboard([
          [inlineButton("Upload image", "upload:start")],
          [inlineButton("Back to menu", "menu:main")],
        ]),
      },
    );
  } catch (error) {
    logMembershipFailure(error, resolveChatId(config.groupChatId), ctx.from.id);
    await ctx.reply(membershipErrorMessage(error), { reply_markup: retryKeyboard });
  }
});

export default composer;
