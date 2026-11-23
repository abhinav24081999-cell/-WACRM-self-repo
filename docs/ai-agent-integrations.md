# Connect an AI agent in WACRM

Only workspace owners and admins can change the connection. A workspace uses one active configuration.

## Google Gemini

1. Open **Agents → Setup → Connection** and select **Google Gemini**.
2. Paste your Gemini API key and select **Load Gemini models**. Choose a model and select **Test key**.
3. Add business instructions in **Behaviour**. Open **Test and activate**, then select **Save and open test chat**.
4. In **Playground**, try a sample conversation.
5. Return to **Setup → Test and activate** and turn on the assistant and automatic replies when ready.

## External agent in n8n

1. Use a **Webhook** node with method **POST** and **Header Auth**. Set the header name to `Authorization` and its value to `Bearer YOUR_SECRET`, using a random secret you control.
2. Configure the Webhook node to respond via a **Respond to Webhook** node. Publish the workflow and copy its **Production URL**.
3. In **Agents → Setup → Connection**, choose **External AI (n8n)**. Paste the URL and the secret without the `Bearer ` prefix. Select **Test workflow**, then save from **Test and activate**.
4. Try a synthetic conversation in **Playground**. Enable automatic replies only after the workflow behaves as expected.

The Webhook node receives a JSON body with `version` (1), `correlation_id`, `mode` (`test` or `live`), `instructions`, and recent `messages` with `role` and `content`. Route `test` requests away from any workflow steps that write data or send messages. Process the conversation and return the result to WACRM within 20 seconds.

Return HTTP 200 with this JSON structure. Use the incoming `correlation_id` unchanged.

```json
{
  "version": 1,
  "correlation_id": "<copy from the incoming request>",
  "reply": "Thanks for reaching out. How can I help?",
  "handoff": false
}
```

Set `handoff` to `true` to request human takeover. If qualification is enabled, the workflow can also return an `assessment` object with `outcome`, an exact `evidence` quote from the latest customer message, and a `follow_up` boolean. The allowed outcomes are `qualified`, `not_interested`, `needs_information` and `human_review`. WACRM sends the WhatsApp replies after checking conversation ownership and current settings. Configure n8n to return its answer without sending separately.

## Outgoing event notifications

Use **Settings → Webhooks** to send event notifications to n8n or another destination. Choose the events and fields, create the paused endpoint, copy the signing secret, and use **Send test**. This sends a sample with event name `webhook.test`. Review the result in **Delivery history**, then enable the endpoint.

Each delivery contains a unique event ID and a timestamp. WACRM signs the timestamp and the raw JSON body with the endpoint secret. Use the [public API signing instructions](public-api.md) when verifying requests.
