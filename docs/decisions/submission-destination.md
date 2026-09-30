# Submission destination

Status: open. Needs the owner's pick.

| Option | Gain | Loss |
|---|---|---|
| SharePoint list (via Power Automate HTTP trigger or Graph) | Lives in M365, easy to view and filter, triage can edit rows in place | Premium Power Automate connector for the HTTP trigger; list schema to maintain |
| Microsoft Forms / Lists form behind the scenes | No code for storage | Loses this page's design and validation; the page becomes a wrapper or goes away |
| Email to a shared mailbox | Simplest; nothing to host | No structured store; triage status lives in people's inboxes |
| Small API plus database (e.g. Azure Function plus table or Postgres) | Full control, clean payload, triage page reads from it | Most to build and own; needs hosting and security review |
| monday.com board (API) | Compass already uses it for tracking; triage as board columns | Another system's auth and limits; data leaves M365 |

Pick this before the submit-adapter work lands, so the adapter targets a real destination.
