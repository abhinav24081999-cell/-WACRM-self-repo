# Contacts, leads, deals and reporting

| Record | Where to work | What it tracks |
| --- | --- | --- |
| Contact | **Contacts** list or Inbox contact drawer | The person, their details, tags and custom fields. Filter or search the list to find them. |
| Lead | Contact drawer **Leads** section | An individual inquiry, its source, qualification, follow-up, ad attribution, form responses and status history. |
| Deal | **Pipelines** | A sales opportunity and its stage and value. Tags, the lead status and the pipeline stage serve different purposes. |

## Contact import and organization

Use **Contacts → Import** to map a small test CSV first. Confirm names, international phone numbers, emails and optional tags on the resulting contacts. Review how repeated phones and existing contacts were handled before importing a full list. Use **Settings → Fields & tags** to manage reusable workspace definitions. Custom-field definitions and a value saved on an individual contact are separate.

## Lead follow-up and feedback

Open a contact's **Leads** section and review the particular inquiry before changing status. The code supports New, Interested, Not interested, Busy, No response, In process, Qualified, Converted, Completed and Junk. Save the desired status and follow-up with the lead details, then check the history.

Ad leads can contain form answers and attribution such as the original provider lead ID, campaign ID or click ID. A manual lead can have no ad attribution. Meta feedback badges reflect linked conversion delivery. Check **Settings → Conversion feedback** for rule mode and delivery history. See the [Meta intake](meta-lead-preview.md), [Google and website intake](google-lead-preview.md), and [conversion feedback](conversion-feedback.md) guides.

## Pipeline and reports

Create a deal from **Pipelines**, set its stage and value, and move it using the board as the opportunity progresses. Configure stages in pipeline settings and reporting currency in **Settings → Deals & currency**. Use pipeline analytics to compare stage totals. The contact drawer focuses on contact details and leads, while the pipeline remains the place to manage deals.

Use **Dashboard** to review reply workload, message activity and failures. Use [Ads Performance](ads-performance.md) to inspect attributed CRM results and connected provider spend. Before presenting a cost metric, check the time zone, filter selection and whether the relevant spend feed is available. In **Notifications**, verify unread and read state. Browser popups depend on granting browser permission, and team presence is based on a heartbeat.

Code references include [contacts](../src/components/contacts), [lead management migration](../supabase/migrations/20261121120000_lead_management.sql), [pipelines](../src/components/pipelines), [dashboard](../src/components/dashboard), and [notifications](../src/lib/notifications).
