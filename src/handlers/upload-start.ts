import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { inlineButton, inlineKeyboard, registerMainMenuItem } from "../toolkit/index.js";
import { createJob, getUser, isActive, saveUser, settings } from "../domain-store.js";

registerMainMenuItem({ label: "Upload image", data: "upload:start", order: 10 });
const composer = new Composer<Ctx>();
const back = inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]);

composer.callbackQuery("upload:start", async (ctx) => {
  await ctx.answerCallbackQuery();
  ctx.session.flow = "upload_image";
  delete ctx.session.imageFileId;
  await ctx.reply("Send one image to prepare it for upscaling.", { reply_markup: back });
});

async function acceptImage(ctx: Ctx, fileId: string) {
  if (ctx.session.flow !== "upload_image") return;
  ctx.session.imageFileId = fileId;
  ctx.session.flow = "upload_tier";
  await ctx.reply("Choose the upscale tier.", { reply_markup: inlineKeyboard([[inlineButton("Standard 2×", "upload:tier:standard"), inlineButton("Pro 4×", "upload:tier:pro")], [inlineButton("Back to menu", "menu:main")]]) });
}
composer.on("message:photo", async (ctx) => { const photo = ctx.message.photo.at(-1); if (photo) await acceptImage(ctx, photo.file_id); });
composer.on("message:document", async (ctx) => { if (ctx.session.flow !== "upload_image") return; if (!ctx.message.document.mime_type?.startsWith("image/")) { await ctx.reply("That file isn’t an image. Send a JPG, PNG, or WebP image."); return; } await acceptImage(ctx, ctx.message.document.file_id); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.flow === "upload_image") { await ctx.reply("Send an image file, or tap Back to menu.", { reply_markup: back }); return; } return next(); });

composer.callbackQuery(/^upload:tier:(standard|pro)$/, async (ctx) => {
  await ctx.answerCallbackQuery();
  const tier = ctx.match[1] as "standard" | "pro";
  const image = ctx.session.imageFileId;
  if (ctx.session.flow !== "upload_tier" || !image || !ctx.from) { await ctx.reply("Start again by tapping Upload image.", { reply_markup: back }); return; }
  const config = await settings(ctx);
  if (!config.groupChatId) { await ctx.reply("Group checks aren’t set up yet. Ask the owner to configure the membership group.", { reply_markup: back }); return; }
  const user = await getUser(ctx, ctx.from.id);
  if (!user?.groupMember) { await ctx.reply("Join the group and check your membership before you upscale an image.", { reply_markup: inlineKeyboard([[inlineButton("Join group", "group:join"), inlineButton("Check membership", "group:check")], [inlineButton("Back to menu", "menu:main")]]) }); return; }
  const active = user && isActive(user);
  if (tier === "pro" && !active || tier === "pro" && user?.tier !== "pro") { await ctx.reply("Pro upscaling needs an active Pro subscription. Send a payment proof to request it.", { reply_markup: inlineKeyboard([[inlineButton("Send payment proof", "payment:start")], [inlineButton("View pricing", "pricing:show")]]) }); return; }
  if (tier === "standard" && !active && (user?.credits ?? 0) < 1) { await ctx.reply("Your included Standard credit has been used. Choose a subscription and send a payment proof.", { reply_markup: inlineKeyboard([[inlineButton("View pricing", "pricing:show")], [inlineButton("Send payment proof", "payment:start")]]) }); return; }
  const stored = await createJob(ctx, ctx.from.id, image, tier);
  if (!stored) { await ctx.reply("Image jobs aren’t set up yet. Please try again after the owner finishes setup.", { reply_markup: back }); return; }
  if (tier === "standard" && !active) await saveUser(ctx, { ...user!, credits: user!.credits - 1 });
  ctx.session.flow = undefined; delete ctx.session.imageFileId;
  await ctx.reply(`Your ${tier === "pro" ? "Pro 4×" : "Standard 2×"} job is queued. We’ll send the preview here when processing is connected.`, { reply_markup: back });
});
export default composer;
