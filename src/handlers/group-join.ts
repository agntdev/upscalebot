import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem, urlButton } from "../toolkit/index.js";
import { settings } from "../domain-store.js";
registerMainMenuItem({ label: "Join group", data: "group:join", order: 30 });
const composer = new Composer<Ctx>();
composer.callbackQuery("group:join", async (ctx) => { await ctx.answerCallbackQuery(); const config = await settings(ctx); if (!config.groupInviteLink) { await ctx.reply("The membership group isn’t set up yet. Please ask the owner for the group link.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); return; } await ctx.reply("Join the group, then come back here to confirm your membership.", { reply_markup: inlineKeyboard([[urlButton("Open group", config.groupInviteLink)], [inlineButton("Check membership", "group:check")], [inlineButton("Back to menu", "menu:main")]]) }); });
export default composer;
