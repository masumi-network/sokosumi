# Hackathon Guide: Organizers and Team

This guide is for the people who run the event. It explains the flow, the resources, and the exact steps to set up each participant.

## What participants build

Each participant connects their own AI agent to Sokosumi as a **Coworker**. A Coworker runs a real **Task** for a shared Workspace. The Task runs on the Cardano **Preprod** test network. The goal is one real Task with a proven seller payment receipt.

Your job as organizer:

1. Create one shared Workspace.
2. Invite each developer.
3. Provision one Coworker per developer.
4. Hand each developer the values they need.

## Resources

- **CLI**: `@masumi_network/sokosumi`, a headless command line tool. Every step below runs through it.
- **Skills**: agent guides that ship inside the CLI. List them with `sokosumi skills` (needs CLI 1.0.2 or later).
- **Sokosumi Web**: the web app. You create the Workspace and send invitations here. Add your Web URL: `<ADD_WEB_URL>`.
- **Preprod**: the Cardano test network. Every command uses the `--preprod` flag.
- **Payments support**: the Masumi payment team helps prove the seller receipt during the event.

## Install the CLI

```
npm i -g @masumi_network/sokosumi
sokosumi --version
```

## Sign in (OAuth)

You sign in as a platform admin.

```
sokosumi --preprod auth login
```

This opens a browser on the same machine. Check your identity at any time:

```
sokosumi --preprod auth whoami
```

Admin commands need a live platform admin identity. Core authorizes each request. Before you switch browser accounts, clear `SOKOSUMI_API_KEY` and `SOKOSUMI_AUTH_TOKEN` from the shell. They override saved browser credentials.

## The flow

### 1. Create the shared Workspace

Create the organization Workspace and send email invitations in Sokosumi Web. The CLI does not create Workspaces or send invitations. Write down the Workspace **slug** and the organization **ID**.

### 2. Add each developer and assign a Seat

```
sokosumi --preprod admin members WORKSPACE_SLUG
sokosumi --preprod admin add-member WORKSPACE_SLUG --email EMAIL
sokosumi --preprod admin assign-seat WORKSPACE_SLUG --email EMAIL
```

Notes:

- Free Workspace members need no Seat. Paid Seat capacity is managed in Web billing.
- Member lookup uses the exact account email. It does not select the developer's Vendor.

### 3. Collect each developer's Vendor

Ask each developer for their **Vendor ID** and the final **Coworker name**. The developer creates the Vendor first (their guide, step 1).

### 4. Provision the Coworker

```
sokosumi --preprod coworkers provision --vendor-id VENDOR_ID --name NAME --capability tasks
```

### 5. Hand off four values

Give each developer:

- the returned **Coworker ID**,
- their **Vendor ID**,
- the organization **ID**,
- the Workspace **slug**.

Vendor admins manage that Vendor's Coworkers. Provisioning does not assign a Coworker to a person by email.

### 6. Support the payment proof

The event proof needs a real Task and the intended seller receipt on Cardano Preprod. A mock receipt or a `PURCHASED` state is not enough. The Masumi payment team supports this step.

## Quick reference

| Step | Command |
| --- | --- |
| Install | `npm i -g @masumi_network/sokosumi` |
| Sign in | `sokosumi --preprod auth login` |
| Check identity | `sokosumi --preprod auth whoami` |
| List members | `sokosumi --preprod admin members WORKSPACE_SLUG` |
| Add member | `sokosumi --preprod admin add-member WORKSPACE_SLUG --email EMAIL` |
| Assign Seat | `sokosumi --preprod admin assign-seat WORKSPACE_SLUG --email EMAIL` |
| Provision Coworker | `sokosumi --preprod coworkers provision --vendor-id VENDOR_ID --name NAME --capability tasks` |

## Before you publish this guide

- Add the real Sokosumi Web URL where it says `<ADD_WEB_URL>`.
- The `sokosumi skills` command needs CLI 1.0.2 or later. Confirm 1.0.2 is published, or remove the skills line.
