import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { settings } from "../domain-store.js";
registerMainMenuItem({ label: "Pricing", data: "pricing:show", order: 20 });
const composer = new Composer<Ctx>();
composer.callbackQuery("pricing:show", async (ctx) => { await ctx.answerCallbackQuery(); const plan = await settings(ctx); await ctx.reply(`Choose the detail you need.\n\n${plan.standardLabel}: 2× upscaling.\n${plan.proLabel}: 4× upscaling.\n\nSubscriptions are approved manually after payment proof.`, { reply_markup: inlineKeyboard([[inlineButton("Send payment proof", "payment:start")], [inlineButton("Back to menu", "menu:main")]]) }); });
export default composer;
