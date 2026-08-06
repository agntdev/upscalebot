# ImageUpscaler Bot — Bot specification

**Archetype:** custom

**Voice:** professional and concise — write every user-facing message, button label, error, and empty state in this voice.

A Telegram bot that offers two-tier image upscaling (Standard and Pro) with manual subscription approvals. Users must join the owner’s Telegram group to receive credits. Admins handle payment proofs and subscription grants manually.

> This is the complete contract for the bot. Implement EVERY entry point, flow, feature, integration, and edge case below. The completeness review checks the bot against this document after each build pass.

## Primary audience

- general Telegram users
- casual photographers
- social media creators
- small content creators

## Success criteria

- Users can upload images and receive upscaled results
- Admins can approve subscriptions via manual approval flow
- Group membership is enforced before granting credits

## Entry points

Every feature must be reachable from the bot's command/button surface (button-first; only /start and /help are slash commands).

- **/start** (command, actor: user, command: /start) — Open main menu with subscription status and core actions
- **Upload Image** (button, actor: user, callback: upload:start) — Initiate image upload flow
  - inputs: image file
  - outputs: upscale tier selection
- **Pricing** (button, actor: user, callback: pricing:show) — Display subscription tier details
  - outputs: tier comparison
- **Join Group** (button, actor: user, callback: group:join) — Show group membership instructions
  - outputs: group invite link
- **Check Membership** (button, actor: user, callback: group:check) — Verify group membership status
  - outputs: membership confirmation

## Flows

### Upload Flow
_Trigger:_ upload:start

1. User sends image
2. Select upscale tier (Standard/Pro)
3. Queue job
4. Return preview link

_Data touched:_ ImageJob

### Subscription Approval
_Trigger:_ admin:approve

1. User sends payment proof to admin
2. Admin receives approval button
3. Admin confirms subscription
4. Bot grants tier for 30 days

_Data touched:_ User, Subscription

### Group Membership Check
_Trigger:_ group:check

1. Verify user is in specified group
2. Grant initial credits if member

_Data touched:_ User

## Owner-supplied settings

The OWNER provides these; they are collected in chat and injected into the environment at deploy. Read each one from the environment where it is used (`ctx.env.<KEY>` / `env.<KEY>` on Cloudflare Workers; `process.env.<KEY>` only as a Node/harness fallback — never the sole read). Do NOT invent your own way of learning the value, do NOT ask for it in a bot message, and do NOT hardcode a default.

- **ADMIN_CHAT_ID** — Where new payment proofs and approval requests are sent
  - this is the OWNER's own chat id; the platform already knows it. Read `ADMIN_CHAT_ID` via `ctx.env` (prefer toolkit `adminChatId` / `requireOwner`) — never ask a user, never treat whoever writes first as the admin, never invent claim-admin or open manage for everyone.
  - may be UNSET at runtime: the bot must still start, and the feature needing ADMIN_CHAT_ID must say so plainly instead of failing.

Your behavioral specs run WITHOUT these values, so no spec may depend on one.

## Data entities

Durable data (must survive a restart) uses the toolkit's persistent store, never in-memory maps.

An entity that merely NAMES an owner-supplied setting above (an admin chat, an API account) is not something to store or discover — read it from the environment.

- **User** _(retention: persistent)_ — Telegram user account with subscription status
  - fields: telegram_id, username, group_member, subscription_tier, expiry_date
- **ImageJob** _(retention: persistent)_ — Image upscaling request and result
  - fields: original_image, upscale_tier, status, result_url
- **Subscription** _(retention: persistent)_ — Manual subscription approval records
  - fields: user_id, tier, approved_by, approval_date
- **Admin** _(retention: persistent)_ — Owner/admin accounts for manual approvals
  - fields: telegram_id, notification_status

## Integrations

- **Telegram** (required) — Bot API messaging and file handling
Call external APIs against their real contract (correct endpoints, ids, params); credentials from env. Do not fake responses.

## Owner controls

- Manage admin accounts
- Configure subscription tiers
- Set group membership requirement
- Adjust result retention period

## Notifications

- New payment proof received
- Subscription approval confirmation
- Group membership verification status

## Permissions & privacy

- Only approved image upscaling allowed
- No explicit content processing
- User data retained for 30 days

## Edge cases

- User not in group when requesting credits
- Failed image upload handling
- Expired subscription auto-downgrade

## Required tests

- End-to-end upload-to-result flow
- Manual subscription approval workflow
- Group membership check enforcement

## Assumptions

- Monthly subscription period (30 days)
- Standard tier = 2x upscale, Pro = 4x
- Group membership is single-group check
- Result retention period = 30 days
