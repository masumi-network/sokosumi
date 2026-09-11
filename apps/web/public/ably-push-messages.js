/**
 * Notification strings for the Sokosumi web push service worker.
 *
 * Loaded by `ably-push-sw.js` with `importScripts`, which runs it in the
 * worker's own global scope, so `MESSAGES` below is the same binding the
 * worker reads. Split out to keep the worker itself readable: the catalog is
 * data that changes whenever a translator edits a string, and the worker is
 * behaviour that changes when push does.
 *
 * Plain JavaScript for the same reason the worker is: the browser fetches
 * this file from `public/` as written, so it never passes through the
 * TypeScript build.
 */

/**
 * Copy of every notification string from apps/web/messages/<locale>.json.
 *
 * A service worker cannot reach next-intl, so this worker duplicates them.
 * Two shapes, because Core stores two: Job, Task and Chat come from
 * `Library.Notifications.<Group>` and are keyed `Notifications.<Group>.<key>`;
 * the system keys sit at the catalog root and Core stores them verbatim.
 *
 * Generated from the catalogs rather than typed by hand, and guarded by
 * `push-service-worker-messages.test.ts`, which fails when a catalog string
 * changes without this copy changing with it. SOK-876 replaces the whole copy
 * with the shared renderer.
 *
 * Written onto the global rather than declared, so the binding the worker
 * reads is the same one whether this file is imported by a browser or run
 * into a sandbox by the tests. A bare `const` here is also a variable no
 * other file in this directory can see, which reads as dead code.
 */
globalThis.MESSAGES = {
  en: {
    "Notifications.Job.completed": "{agentName} completed {jobName}",
    "Notifications.Job.failed": "{agentName} failed to complete {jobName}",
    "Notifications.Job.paymentFailed": "Payment failed for {jobName}",
    "Notifications.Job.inputRequired":
      "{agentName} needs your input for {jobName}",
    "Notifications.Job.refundResolved": "{jobName} was refunded",
    "Notifications.Job.disputeResolved": "Dispute resolved for {jobName}",
    "Notifications.Task.assigned": "You were assigned {taskName}",
    "Notifications.Task.inputRequired":
      "{coworkerName} needs your input for {taskName}",
    "Notifications.Task.approvalRequired":
      "{coworkerName} needs your approval for {taskName}",
    "Notifications.Task.authenticationRequired":
      "{coworkerName} needs authentication for {taskName}",
    "Notifications.Task.outOfCredits":
      "{coworkerName} ran out of credits for {taskName}",
    "Notifications.Task.completed": "{coworkerName} completed {taskName}",
    "Notifications.Task.failed": "{coworkerName} failed to complete {taskName}",
    "Notifications.Task.canceled": "{taskName} was canceled",
    "Notifications.Task.scheduleRepaired":
      "The schedule for {taskName} was repaired",
    "Notifications.Task.scheduleRemovedByOperator":
      "The schedule for {taskName} was removed after review",
    "Notifications.Chat.mentioned": "{authorName} mentioned you in {roomName}",
    "Notifications.Chat.mentionedDirect":
      "{authorName} mentioned you in a direct message",
    "Notifications.Chat.directMessage": "{authorName} sent you a message",
    "Notifications.Chat.directMessages": "{count} messages from {authorName}",
    "Notifications.Chat.roomMessage":
      "{authorName} wrote in channel {roomName}",
    "Notifications.Chat.roomMessages": "{count} messages in channel {roomName}",
    "Notifications.Chat.roomMessageGroup":
      "{authorName} wrote in group {roomName}",
    "Notifications.Chat.roomMessagesGroup":
      "{count} messages in group {roomName}",
    "Notifications.Chat.roomMessageTitle": "{authorName} in channel {roomName}",
    "Notifications.Chat.roomMessageGroupTitle":
      "{authorName} in group {roomName}",
    "notifications.vendorGrant.pending":
      "{vendorName} requested vendor access to your workspace",
    "notifications.coworkerAccess.pending":
      "{coworkerName} requested coworker early access to your workspace",
  },
  de: {
    "Notifications.Job.completed": "{agentName} hat {jobName} abgeschlossen",
    "Notifications.Job.failed":
      "{agentName} konnte {jobName} nicht abschließen",
    "Notifications.Job.paymentFailed": "Zahlung für {jobName} fehlgeschlagen",
    "Notifications.Job.inputRequired":
      "{agentName} benötigt deinen Input für {jobName}",
    "Notifications.Job.refundResolved": "{jobName} wurde erstattet",
    "Notifications.Job.disputeResolved": "Einspruch für {jobName} gelöst",
    "Notifications.Task.assigned": "Dir wurde {taskName} zugewiesen",
    "Notifications.Task.inputRequired":
      "{coworkerName} benötigt deinen Input für {taskName}",
    "Notifications.Task.approvalRequired":
      "{coworkerName} benötigt deine Freigabe für {taskName}",
    "Notifications.Task.authenticationRequired":
      "{coworkerName} benötigt eine Authentifizierung für {taskName}",
    "Notifications.Task.outOfCredits":
      "{coworkerName} hat keine Credits mehr für {taskName}",
    "Notifications.Task.completed":
      "{coworkerName} hat {taskName} abgeschlossen",
    "Notifications.Task.failed":
      "{coworkerName} konnte {taskName} nicht abschließen",
    "Notifications.Task.canceled": "{taskName} wurde abgebrochen",
    "Notifications.Task.scheduleRepaired":
      "Der Zeitplan für {taskName} wurde repariert",
    "Notifications.Task.scheduleRemovedByOperator":
      "Der Zeitplan für {taskName} wurde nach der Prüfung entfernt",
    "Notifications.Chat.mentioned":
      "{authorName} hat dich in {roomName} erwähnt",
    "Notifications.Chat.mentionedDirect":
      "{authorName} hat dich in einer Direktnachricht erwähnt",
    "Notifications.Chat.directMessage":
      "{authorName} hat dir eine Nachricht gesendet",
    "Notifications.Chat.directMessages": "{count} Nachrichten von {authorName}",
    "Notifications.Chat.roomMessage":
      "{authorName} hat im Kanal {roomName} geschrieben",
    "Notifications.Chat.roomMessages":
      "{count} Nachrichten im Kanal {roomName}",
    "Notifications.Chat.roomMessageGroup":
      "{authorName} hat in der Gruppe {roomName} geschrieben",
    "Notifications.Chat.roomMessagesGroup":
      "{count} Nachrichten in der Gruppe {roomName}",
    "Notifications.Chat.roomMessageTitle": "{authorName} im Kanal {roomName}",
    "Notifications.Chat.roomMessageGroupTitle":
      "{authorName} in der Gruppe {roomName}",
    "notifications.vendorGrant.pending":
      "{vendorName} hat Vendor-Zugriff auf den Organisations-Workspace angefordert",
    "notifications.coworkerAccess.pending":
      "{coworkerName} hat Coworker-Early-Access für deinen Workspace angefordert",
  },
  es: {
    "Notifications.Job.completed": "{agentName} completó {jobName}",
    "Notifications.Job.failed": "{agentName} no pudo completar {jobName}",
    "Notifications.Job.paymentFailed": "Error de pago para {jobName}",
    "Notifications.Job.inputRequired":
      "{agentName} necesita tu input para {jobName}",
    "Notifications.Job.refundResolved": "{jobName} fue reembolsado",
    "Notifications.Job.disputeResolved": "Disputa resuelta para {jobName}",
    "Notifications.Task.assigned": "Se te asignó {taskName}",
    "Notifications.Task.inputRequired":
      "{coworkerName} necesita tu input para {taskName}",
    "Notifications.Task.approvalRequired":
      "{coworkerName} necesita tu aprobación para {taskName}",
    "Notifications.Task.authenticationRequired":
      "{coworkerName} necesita autenticación para {taskName}",
    "Notifications.Task.outOfCredits":
      "{coworkerName} se quedó sin créditos para {taskName}",
    "Notifications.Task.completed": "{coworkerName} completó {taskName}",
    "Notifications.Task.failed": "{coworkerName} no pudo completar {taskName}",
    "Notifications.Task.canceled": "{taskName} fue cancelado",
    "Notifications.Task.scheduleRepaired":
      "Se reparó la programación de {taskName}",
    "Notifications.Task.scheduleRemovedByOperator":
      "Se eliminó la programación de {taskName} después de revisarla",
    "Notifications.Chat.mentioned": "{authorName} te mencionó en {roomName}",
    "Notifications.Chat.mentionedDirect":
      "{authorName} te mencionó en un mensaje directo",
    "Notifications.Chat.directMessage": "{authorName} te envió un mensaje",
    "Notifications.Chat.directMessages": "{count} mensajes de {authorName}",
    "Notifications.Chat.roomMessage":
      "{authorName} escribió en el canal {roomName}",
    "Notifications.Chat.roomMessages":
      "{count} mensajes en el canal {roomName}",
    "Notifications.Chat.roomMessageGroup":
      "{authorName} escribió en el grupo {roomName}",
    "Notifications.Chat.roomMessagesGroup":
      "{count} mensajes en el grupo {roomName}",
    "Notifications.Chat.roomMessageTitle":
      "{authorName} en el canal {roomName}",
    "Notifications.Chat.roomMessageGroupTitle":
      "{authorName} en el grupo {roomName}",
    "notifications.vendorGrant.pending":
      "{vendorName} solicitó acceso de proveedor al workspace de la organización",
    "notifications.coworkerAccess.pending":
      "{coworkerName} solicitó acceso anticipado de coworker a tu espacio de trabajo",
  },
};
