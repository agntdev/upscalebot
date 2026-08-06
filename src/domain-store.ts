/** Durable application records. D1 is the Worker persistent store; the harness
 * has no binding, so callers gracefully report that the affected action is not
 * configured rather than keeping records in process memory. */
export type Tier = "free" | "standard" | "pro";
export interface UserRecord { telegramId: number; username?: string; groupMember: boolean; tier: Tier; expiryDate?: string; credits: number; }
export interface Settings { groupChatId?: string; groupInviteLink?: string; retentionDays: number; standardLabel: string; proLabel: string; }

interface Statement { bind(...values: unknown[]): Statement; run(): Promise<unknown>; first<T>(): Promise<T | null>; all<T>(): Promise<{ results: T[] }>; }
interface D1 { prepare(query: string): Statement; batch?(statements: Statement[]): Promise<unknown>; }
type StoreCtx = object;

export function now(): Date { return new Date(); }
export function plusDays(days: number): string { return new Date(now().getTime() + days * 86_400_000).toISOString(); }
function beforeDays(days: number): string { return new Date(now().getTime() - days * 86_400_000).toISOString(); }
export function isActive(user: UserRecord): boolean { return user.tier !== "free" && !!user.expiryDate && new Date(user.expiryDate).getTime() > now().getTime(); }

function db(ctx: StoreCtx): D1 | undefined { return (ctx as { env?: { DB?: unknown } }).env?.DB as D1 | undefined; }
async function ready(ctx: StoreCtx): Promise<D1 | undefined> {
  const connection = db(ctx); if (!connection) return undefined;
  await connection.prepare("CREATE TABLE IF NOT EXISTS iu_users (telegram_id INTEGER PRIMARY KEY, username TEXT, group_member INTEGER NOT NULL DEFAULT 0, tier TEXT NOT NULL DEFAULT 'free', expiry_date TEXT, credits INTEGER NOT NULL DEFAULT 0)").run();
  await connection.prepare("CREATE TABLE IF NOT EXISTS iu_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT, telegram_id INTEGER NOT NULL, original_image TEXT NOT NULL, upscale_tier TEXT NOT NULL, status TEXT NOT NULL, result_url TEXT, created_at TEXT NOT NULL)").run();
  await connection.prepare("CREATE TABLE IF NOT EXISTS iu_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, tier TEXT NOT NULL, approved_by INTEGER, approval_date TEXT, proof_file_id TEXT, status TEXT NOT NULL)").run();
  await connection.prepare("CREATE TABLE IF NOT EXISTS iu_admins (telegram_id INTEGER PRIMARY KEY, notification_status TEXT NOT NULL)").run();
  await connection.prepare("CREATE TABLE IF NOT EXISTS iu_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)").run();
  return connection;
}
function userFrom(row: any): UserRecord { return { telegramId: Number(row.telegram_id), username: row.username ?? undefined, groupMember: Boolean(row.group_member), tier: row.tier as Tier, expiryDate: row.expiry_date ?? undefined, credits: Number(row.credits ?? 0) }; }
export async function getUser(ctx: StoreCtx, id: number): Promise<UserRecord | undefined> { const d = await ready(ctx); const row = d ? await d.prepare("SELECT * FROM iu_users WHERE telegram_id = ?").bind(id).first<any>() : null; return row ? userFrom(row) : undefined; }
export async function saveUser(ctx: StoreCtx, user: UserRecord): Promise<boolean> { const d = await ready(ctx); if (!d) return false; await d.prepare("INSERT INTO iu_users (telegram_id,username,group_member,tier,expiry_date,credits) VALUES (?,?,?,?,?,?) ON CONFLICT(telegram_id) DO UPDATE SET username=excluded.username,group_member=excluded.group_member,tier=excluded.tier,expiry_date=excluded.expiry_date,credits=excluded.credits").bind(user.telegramId,user.username ?? null,user.groupMember ? 1 : 0,user.tier,user.expiryDate ?? null,user.credits).run(); return true; }
export async function settings(ctx: StoreCtx): Promise<Settings> { const d = await ready(ctx); if (!d) return { retentionDays: 30, standardLabel: "Standard — 2×", proLabel: "Pro — 4×" }; const rows = (await d.prepare("SELECT key, value FROM iu_settings").all<{key:string;value:string}>()).results; const value = (key: string) => rows.find((row) => row.key === key)?.value; return { groupChatId: value("group_chat_id"), groupInviteLink: value("group_invite_link"), retentionDays: Number(value("retention_days") ?? 30), standardLabel: value("standard_label") ?? "Standard — 2×", proLabel: value("pro_label") ?? "Pro — 4×" }; }
export async function setSetting(ctx: StoreCtx, key: string, value: string): Promise<boolean> { const d = await ready(ctx); if (!d) return false; await d.prepare("INSERT INTO iu_settings (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(key,value).run(); return true; }
export async function createJob(ctx: StoreCtx, userId: number, image: string, tier: Exclude<Tier,"free">): Promise<boolean> { const d = await ready(ctx); if (!d) return false; const config = await settings(ctx); await d.prepare("DELETE FROM iu_jobs WHERE created_at < ?").bind(beforeDays(config.retentionDays)).run(); await d.prepare("INSERT INTO iu_jobs (telegram_id,original_image,upscale_tier,status,created_at) VALUES (?,?,?,?,?)").bind(userId,image,tier,"queued",now().toISOString()).run(); return true; }
export async function createPendingSubscription(ctx: StoreCtx, userId: number, tier: Exclude<Tier,"free">, proof: string): Promise<number | undefined> { const d = await ready(ctx); if (!d) return undefined; const r: any = await d.prepare("INSERT INTO iu_subscriptions (user_id,tier,proof_file_id,status) VALUES (?,?,?,?)").bind(userId,tier,proof,"pending").run(); return Number(r.meta?.last_row_id); }
export async function approveSubscription(ctx: StoreCtx, id: number, adminId: number): Promise<{userId:number;tier:Exclude<Tier,"free">} | undefined> { const d = await ready(ctx); if (!d) return undefined; const row = await d.prepare("SELECT user_id,tier FROM iu_subscriptions WHERE id = ? AND status = 'pending'").bind(id).first<any>(); if (!row) return undefined; await d.prepare("UPDATE iu_subscriptions SET status='approved',approved_by=?,approval_date=? WHERE id=?").bind(adminId,now().toISOString(),id).run(); return { userId:Number(row.user_id), tier:row.tier }; }
export async function registerAdmin(ctx: StoreCtx, id: number): Promise<void> { const d = await ready(ctx); if (d) await d.prepare("INSERT INTO iu_admins (telegram_id,notification_status) VALUES (?,?) ON CONFLICT(telegram_id) DO NOTHING").bind(id,"enabled").run(); }
