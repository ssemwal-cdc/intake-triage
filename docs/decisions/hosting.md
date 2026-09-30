# Hosting

Status: ruled 2026-09-30, GitHub Pages (public site repo), submissions in a private repo. See submission-destination and threat-model.

| Option | Gain | Loss |
|---|---|---|
| SharePoint Online page or Power Pages | Inside M365, Entra sign-in for free, IT already runs it | Custom HTML/JS is restricted; the port likely has to be rebuilt as a SharePoint web part or Power Pages form |
| Azure Static Web Apps | Serves these files as-is, Entra sign-in built in, free tier, triage page can be locked to a role | Needs an Azure subscription and IT sign-off; someone owns the deploy |
| Internal web server (IIS or similar on the Compass network) | Files as-is, stays on-network | Server to patch and own; sign-in has to be wired separately |
| GitHub Pages (private org, Enterprise) | Files as-is, deploy on push | Access control is GitHub accounts, not Entra; poor fit for non-developers |

The public form and the triage view need different access. Whichever host is picked must lock `triage.html` to the CFO team.

## GitHub Pages plus repo storage (raised by the owner)

- Pages serves the files. It cannot write to the repo without a token, and a token in page code is public.
- Needs a relay (Power Automate flow or small serverless function) that holds the token and commits each submission as JSON. Or the form opens a prefilled GitHub issue; then every requester needs a GitHub account.
- Code is not sensitive; submissions can be (step 5 asks about investor, customer, personnel data). Public Pages lets anyone with the triage link read them. Private Pages needs GitHub Enterprise Cloud and a GitHub account per reader.
