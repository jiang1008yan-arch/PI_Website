# Feishu identity, bot recipients and permission fixes

Agreed with the user on 2026-10-21.

## Problems

1. The two bots linked people separately: PI Assistant by `union_id` ("Sign in with Feishu" + password),
   the after-sales bot (售后工单Robot) by `open_id` through a `bind` link that silently linked whichever site
   account was signed in on that browser. One person could end up on two different site accounts (this is how a
   tester's Feishu got linked to a commerce account).
2. People who were picked but never linked got nothing, and nobody was told. No presales pick = no message at all.
3. Admins could not see or remove Feishu links.
4. After-sales only saw the approved Chinese version of a PI (no current version, no English PI).
5. Admins could watch the commerce queue but not decide.

## Decisions

| # | Decision |
|---|---|
| 1 | **One identity for both bots: `users.feishuUnionId`.** Both bots look people up by `union_id` and send by `union_id`. `feishuOpenId` is kept only as a fallback for links made before this change; the first event from such a person backfills their `union_id`. |
| 2 | **Linking is always explicit.** The after-sales bot's "link your account" card now opens "Sign in with Feishu" (site username + password on first use). The old token-based `/feishu/bind` page and table are removed. |
| 3 | **Auto-link by mobile number.** Admins enter each user's Feishu mobile in Permission Management. On save the portal looks it up in the Feishu directory (`contact/v3/users/batch_get_id`, needs `contact:user.id:readonly` on the PI Assistant app) and links the account. The user list shows each person's link status and an Unlink button. Names are never used for matching. |
| 4 | **Nobody to notify → admins.** When a PI step's approver is not picked or not linked, the action card goes to every linked admin with a line saying who should handle it and why they did not get it. Same for a ticket whose after-sales owner is not linked. Approver pickers mark people who are not linked to Feishu. |
| 5 | **After-sales read the full PI** (current + approved Chinese version and the linked English PI), still read-only and without Excel download. |
| 6 | **Admins may decide the commerce step** at any time, even when a commerce approver was picked. Earlier cards close as usual. |

## Recipients after the change

| Bot | Event | To |
|---|---|---|
| PI Assistant | Submitted (presales step) | Picked presales approver; not picked / not linked → linked admins |
| | Presales approved (commerce step) | Picked commerce approver, or every commerce user when none picked; nobody linked → linked admins |
| | Approved / rejected | The PI's creator (if linked) |
| 售后工单Robot | Staff @-mention | Ticket creators (ADMIN/SERVICE): private card; anyone else → after-sales group |
| | Ticket card, daily reminder | After-sales owner; owner not linked → a notice to the linked admins |
| | Ticket changes | Sales owner (text, if linked) |
| | Resolved | Customer group |
| | Device alerts, repeat faults, weekly summary | After-sales group |

## Feishu console steps (user)

- PI Assistant app: add permission **通过手机号或邮箱获取用户 ID** (`contact:user.id:readonly`), set the contacts data
  range to all staff, publish a version.
