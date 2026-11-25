# Connect an AI agent in WACRM

Only workspace owners and admins can change the connection. A workspace uses one active configuration.

## Google Gemini

1. Open **Agents → Setup**. In **Provider & key**, select **Google Gemini** and follow **Get a Gemini API key** to Google AI Studio.
2. Paste your Gemini API key and select **Load models**. Choose a model and select **Test connection**.
3. Add business instructions in **Behaviour**, then select **Save and open test chat**.
4. In **Playground**, try a sample conversation.
5. Return to **Setup**. In **Activation**, turn on the assistant and automatic replies when ready, then select **Save settings**.

## External agent in n8n

1. Use a **Webhook** node with method **POST** and **Header Auth**. Set the header name to `Authorization` and its value to `Bearer YOUR_SECRET`, using a random secret you control.
2. Configure the Webhook node to respond via a **Respond to Webhook** node. Publish the workflow and copy its **Production URL**.
3. In **Agents → Setup**, choose **External AI (n8n)** under **Provider & key**. Paste the URL and the secret without the `Bearer ` prefix. Select **Test workflow**, then **Save settings**.
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

Set `handoff` to `true` to request human takeover. If qualification is enabled, the workflow can also return an `assessment` object with `outcome`, an exact `evidence` quote from the latest customer message, and a `follow_up` boolean. The allowed outcomes are `qualified`, `not_interested`, `needs_information` and `human_review`. WACRM checks conversation ownership and current settings before sending the reply on the selected channel. Configure n8n to return its answer without sending separately.

WACRM retries HTTP 502, 503, and 504 once when time remains, with the same
`correlation_id`. It leaves retries after ambiguous network failures to the
operator. Use the correlation ID to match execution records in n8n with
HTTP status and attempt entries in the app's runtime logs.

## Outgoing event notifications

Use **Settings → Webhooks** to send event notifications to n8n or another destination. Choose the events and fields, create the paused endpoint, copy the signing secret, and use **Send test**. This sends a sample with event name `webhook.test`. Review the result in **Delivery history**, then enable the endpoint.

Each delivery contains a unique event ID and a timestamp. WACRM signs the timestamp and the raw JSON body with the endpoint secret. Use the [public API signing instructions](public-api.md) when verifying requests.

## Provider setup and knowledge

From **Agents → Setup**, choose OpenAI, Anthropic, Gemini, OpenAI-compatible or External AI (n8n). The native providers use their own key and model. For a compatible provider, supply the gateway URL and a model it exposes. The settings form indicates when a saved key is in use. Test the provider, save the configuration and use Playground before allowing live replies. The server checks workspace permissions and the plan's AI feature.

Add business instructions and manage knowledge in Setup. The knowledge base can use text search. Semantic retrieval requires a configured embeddings key and indexing. After editing the knowledge, try a question in Playground that should retrieve the updated answer. Review **Usage** for recorded calls, including draft, playground and automatic reply usage where present.

## Qualification and takeover

Add explicit qualification criteria and, if needed, select a qualified contact tag and enable automatic application. An assessment must cite evidence from the latest inbound message. Inspect the assessment on a test contact before relying on automatic tagging. Qualification notes and tags are separate from a CRM lead milestone and provider conversion delivery.

The inbox supports drafting a reply for human review. With automatic replies enabled, the application checks the conversation's cap and pause state. A handoff pauses automatic replies for that conversation, records a summary, and can route an unassigned thread to the configured teammate. Use a synthetic inbound chat to verify the reply, manual takeover and resuming the assistant where appropriate. If configuration fails to load, see [operations troubleshooting](architecture-and-operations.md#troubleshooting).
