# After-sales work happens in Feishu; this system is the record

Customers talk to us in Feishu external groups and after-sales staff live in Feishu, so tickets are created and updated from Feishu (message shortcut "turn into ticket", or a customer @-mentioning the bot) and every change is written back here, where tickets, PIs, devices and fault statistics are kept. Ticket creation is always human-triggered: the bot only reads messages a staff member selected or that @-mention it, and AI only suggests a summary and fault type that a staff member must confirm. Internal detail never reaches the customer: the external group gets only a receipt and a "resolved" notice, while the interactive ticket card lives in the internal after-sales group.

## Considered Options

- **Bot reads every group message and AI decides what is an issue** — rejected: needs Feishu's sensitive all-messages permission, and false positives would create noise tickets.
- **Feishu Bitable as the ticket store** — rejected: statistics and PI/device links need the data here; a table would have to be polled back.
- **Webhook notifications that link back to this system** — rejected: staff would still have to leave Feishu to update a ticket.

## Consequences

Customers without Feishu (WeChat/WhatsApp) cannot use the group flow; the public ticket form link stays as the fallback. Each Feishu user must bind to a system account before their card actions count. AI suggestions use Qwen (`qwen-plus` on Alibaba Cloud Model Studio, reachable from mainland China) and are requested only when staff press 创建工单, so ordinary chat costs nothing.
