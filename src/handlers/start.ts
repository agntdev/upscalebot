import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { mainMenuKeyboard } from "../toolkit/index.js";
import { getUser, isActive, saveUser } from "../domain-store.js";

// The /start handler renders the bot's MAIN MENU — the primary way users operate
// a button-first bot. A feature adds its own button by calling
// `registerMainMenuItem(...)` in its own `src/handlers/<slug>.ts`; this handler
// renders whatever is registered (plus a Help button), so you do NOT edit this
// file to add a feature. Send ONE message — no placeholder line above the menu.
const composer = new Composer<Ctx>();

async function welcome(ctx: Ctx): Promise<string> {
  const id = ctx.from?.id;
  if (!id) return "Welcome to ImageUpscaler. Choose an action below.";
  const user = await getUser(ctx, id);
  if (!user || !isActive(user)) {
    if (user && user.tier !== "free") await saveUser(ctx, { ...user, tier: "free", expiryDate: undefined });
    return "Welcome to ImageUpscaler. Your plan: Free. Choose an action below.";
  }
  return `Welcome to ImageUpscaler. Your plan: ${user.tier === "pro" ? "Pro" : "Standard"}. Choose an action below.`;
}

composer.command("start", async (ctx) => {
  await ctx.reply(await welcome(ctx), { reply_markup: mainMenuKeyboard() });
});

// "Back to menu" — re-render the main menu in place from any sub-view.
composer.callbackQuery("menu:main", async (ctx) => {
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(await welcome(ctx), { reply_markup: mainMenuKeyboard() });
});

export default composer;
