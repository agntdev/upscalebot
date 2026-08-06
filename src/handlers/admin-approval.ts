import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, requireOwner } from "../toolkit/index.js";
import { approveSubscription, getUser, plusDays, registerAdmin, saveUser } from "../domain-store.js";
const composer = new Composer<Ctx>();
composer.callbackQuery(/^admin:approve:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx)) || !ctx.from) return; await registerAdmin(ctx, ctx.from.id); const approved = await approveSubscription(ctx, Number(ctx.match[1]), ctx.from.id); if (!approved) { await ctx.reply("That payment proof is no longer waiting for approval."); return; } const user = await getUser(ctx, approved.userId); const saved = await saveUser(ctx, { telegramId: approved.userId, username: user?.username, groupMember: user?.groupMember ?? false, tier: approved.tier, expiryDate: plusDays(30), credits: user?.credits ?? 0 }); if (!saved) { await ctx.reply("The subscription couldn’t be granted because storage isn’t available."); return; } try { await ctx.api.sendMessage(approved.userId, `Your ${approved.tier === "pro" ? "Pro" : "Standard"} subscription is active for 30 days.`); } catch { /* The user may have blocked the bot; approval remains durable. */ }
  await ctx.reply("Subscription approved for 30 days.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); });
composer.callbackQuery(/^admin:decline:(\d+)$/, async (ctx) => { await ctx.answerCallbackQuery(); if (!(await requireOwner(ctx))) return; await ctx.reply("This payment proof wasn’t approved. Ask the user to send a clearer proof."); });
export default composer;
