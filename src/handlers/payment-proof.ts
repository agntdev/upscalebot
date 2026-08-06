import { Composer } from "grammy";
import type { Ctx } from "../bot.js";
import { adminChatId, inlineButton, inlineKeyboard } from "../toolkit/index.js";
import { createPendingSubscription } from "../domain-store.js";

const composer = new Composer<Ctx>();
const tiers = inlineKeyboard([[inlineButton("Standard 2×", "payment:tier:standard"), inlineButton("Pro 4×", "payment:tier:pro")], [inlineButton("Back to menu", "menu:main")]]);
composer.callbackQuery("payment:start", async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.flow = "payment_tier"; await ctx.reply("Choose the subscription you paid for.", { reply_markup: tiers }); });
composer.callbackQuery(/^payment:tier:(standard|pro)$/, async (ctx) => { await ctx.answerCallbackQuery(); ctx.session.flow = "payment_proof"; ctx.session.paymentTier = ctx.match[1] as "standard" | "pro"; await ctx.reply("Send the payment proof as an image or file.", { reply_markup: inlineKeyboard([[inlineButton("Back to menu", "menu:main")]]) }); });
async function receiveProof(ctx: Ctx, fileId: string, kind: "photo" | "document") {
  if (ctx.session.flow !== "payment_proof" || !ctx.from || !ctx.session.paymentTier) return;
  const tier = ctx.session.paymentTier;
  const id = await createPendingSubscription(ctx, ctx.from.id, tier, fileId);
  ctx.session.flow = undefined; delete ctx.session.paymentTier;
  if (!id) { await ctx.reply("Payment approvals aren’t set up yet. Please contact the owner."); return; }
  const owner = adminChatId(ctx);
  if (!owner) { await ctx.reply("Your proof was saved, but the approval inbox isn’t set up yet. Please contact the owner."); return; }
  const markup = inlineKeyboard([[inlineButton("Approve subscription", `admin:approve:${id}`), inlineButton("Decline", `admin:decline:${id}`)]]);
  try {
    const caption = `New ${tier} payment proof needs review.`;
    if (kind === "photo") await ctx.api.sendPhoto(owner, fileId, { caption, reply_markup: markup });
    else await ctx.api.sendDocument(owner, fileId, { caption, reply_markup: markup });
    await ctx.reply("Your payment proof is with the owner for review. We’ll confirm your subscription here.");
  } catch { await ctx.reply("Your proof was saved, but we couldn’t notify the owner yet. Please contact the owner."); }
}
composer.on("message:photo", async (ctx, next) => { if (ctx.session.flow !== "payment_proof") return next(); const image = ctx.message.photo.at(-1); if (image) await receiveProof(ctx, image.file_id, "photo"); });
composer.on("message:document", async (ctx, next) => { if (ctx.session.flow !== "payment_proof") return next(); await receiveProof(ctx, ctx.message.document.file_id, "document"); });
composer.on("message:text", async (ctx, next) => { if (ctx.session.flow !== "payment_proof") return next(); await ctx.reply("Send the payment proof as an image or file."); });
export default composer;
