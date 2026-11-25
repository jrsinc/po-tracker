# Weekly "Active orders" email to every Account Manager (Power Automate)

**What it does:** every **Tuesday at 8:00 AM Eastern**, each Account Manager gets one email
listing their **Active** PO lines from the SharePoint list *PO Tracking 2026 JRS INC*.

**Why Power Automate:** sending email on a schedule needs something that runs while nobody
has the app open. Power Automate is part of Microsoft 365, works directly on the SharePoint
list, and uses only standard connectors (SharePoint and Office 365 Outlook), so no extra
server is needed. It doesn't change the list.

Build it at **https://make.powerautomate.com**, signed in with the account that should send
the emails (or one with access to a shared mailbox, see step 10).

---

## 1. Create the flow

**+ Create › Scheduled cloud flow**

- Flow name: `Weekly active POs to account managers`
- Starting: next Tuesday, 8:00 AM
- Repeat every: **1 Week**, on **Tuesday**

Click **Create**.

## 2. Recurrence trigger: set Eastern time

Open the **Recurrence** step and set these advanced parameters:

| Setting | Value |
|---|---|
| Interval / Frequency | 1 / Week |
| Time zone | **(UTC-05:00) Eastern Time (US & Canada)** (switches between EST and EDT automatically) |
| On these days | Tuesday |
| At these hours | 8 |
| At these minutes | 0 |

## 3. Get the active orders

**+ New step › SharePoint › Get items**

| Setting | Value |
|---|---|
| Site Address | `https://jrsllc1.sharepoint.com/sites/jrsllc` |
| List Name | `PO Tracking 2026 JRS INC` |
| Filter Query | `Status eq 'Active'` |
| Order By | `Title` |
| Top Count | `5000` |

Then open the step's **⋯ › Settings**, turn **Pagination** on, and set the threshold to `5000`.

> To include more statuses, change the filter, for example
> `Status eq 'Active' or Status eq 'Ready to Ship'`.

## 4. List the account managers' emails

**+ New step › Data Operation › Select**. Rename it to `Managers`.

- From: *Get items › value* (dynamic content)
- Map: switch to **text mode** (the icon on the right of Map) and enter the expression
  `item()?['AccountManager']?['Email']`

## 5. Remove duplicates

**+ New step › Data Operation › Compose**. Rename it to `Unique managers`.

- Inputs (expression): `union(body('Managers'), body('Managers'))`

## 6. One email per manager

**+ New step › Control › Apply to each**

- Select an output from previous steps: *Outputs* of **Unique managers**

Add the remaining steps **inside** this loop.

### 6a. Skip lines with no Account Manager

**Control › Condition**: expression `empty(items('Apply_to_each'))` **is equal to** `false`.

Put steps 6b–6e in the **True** branch.

### 6b. This manager's lines

**Data Operation › Filter array**

- From: *Get items › value*
- Condition: `item()?['AccountManager']?['Email']` **is equal to** `items('Apply_to_each')`
  (use the expression editor for both sides)

### 6c. Choose the email's columns

**Data Operation › Select**. Rename it to `Rows`.

- From: *Body* of **Filter array**
- Map (key → value expression):

| Key | Value (expression) |
|---|---|
| Folder # | `item()?['Title']` |
| Line | pick **Line#** from dynamic content (usually `item()?['OData__x0077_tp0']`) |
| Customer | `item()?['Customer']?['Value']` |
| Product | `item()?['ProductName']` |
| Customer PO # | `item()?['CustomerPO']` |
| Remarks on status | `item()?['RemarksOnStatus']?['Value']` |
| Remarks | `item()?['Remarks']` |
| Received | `if(empty(item()?['ReceivedDate']), '', formatDateTime(item()?['ReceivedDate'], 'dd MMM yyyy'))` |

> The keys are the email's column headings, and you can add or remove rows here. If an
> expression shows blank in a test run, pick the column from dynamic content instead.
> Choice columns (Customer, Remarks On Status, Status) need the **Value** part.

### 6d. Make it a table

**Data Operation › Create HTML table**

- From: *Output* of **Rows**
- Columns: Automatic

### 6e. Send the email

**Office 365 Outlook › Send an email (V2)**

| Setting | Value |
|---|---|
| To | `items('Apply_to_each')` (expression) |
| Subject | `Active POs – @{formatDateTime(convertFromUtc(utcNow(),'Eastern Standard Time'),'dd MMM yyyy')} (@{length(body('Filter_array'))} lines)` |
| Body | see below |

Body, using the code view (`</>`) of the editor:

```html
<p>Hello,</p>
<p>Here are your <b>active</b> PO lines as of today:</p>
@{replace(body('Create_HTML_table'), '<table>', '<table border="1" cellpadding="6" style="border-collapse:collapse;font-family:Segoe UI,Arial;font-size:13px">')}
<p>Open the PO Tracker app or the
<a href="https://jrsllc1.sharepoint.com/sites/jrsllc/Lists/PO%20Tracking%202026%20JRS%20INC/AllItems.aspx">SharePoint list</a>
to update them.</p>
```

## 7. Test

**Save › Test › Manually › Run flow.** Check the run: each manager in **Unique managers**
should get one email with only their lines. Once it looks right, leave the flow **On**.

---

### Options

- **Send from a shared mailbox** (for example `orders@…`): use **Send an email from a shared
  mailbox (V2)** in step 6e instead.
- **Copy a supervisor:** add their address in **CC** in step 6e.
- **Managers with no active lines get nothing.** To send them an "all clear" email, the flow
  needs a fixed list of managers; ask and it can be adapted.
- **Licensing:** SharePoint and Office 365 Outlook are standard connectors, included with
  Microsoft 365 business plans.
