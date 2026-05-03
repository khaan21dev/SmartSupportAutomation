const { app } = require('@azure/functions');
const { TextAnalysisClient } = require("@azure/ai-language-text");
const { TableClient } = require("@azure/data-tables");
const { DefaultAzureCredential } = require("@azure/identity");
const axios = require('axios'); // Added to allow the script to "call" your Logic App

const credential = new DefaultAzureCredential();

const aiClient = new TextAnalysisClient(process.env.AI_ENDPOINT, credential);
const tableClient = new TableClient(
    `https://${process.env.STORAGE_ACCOUNT_NAME}.table.core.windows.net`, 
    "tickets", 
    credential
);

app.http('classifyTicket', {
    methods: ['POST'],
    authLevel: 'anonymous',
    handler: async (request, context) => {
        try {
            const body = await request.json();
            const text = body.text;

            // 1. Call Azure AI for Sentiment
            const [result] = await aiClient.analyze("SentimentAnalysis", [text]);
            const sentiment = result.sentiment;

            // 2. Simple Urgency Logic
            let urgency = "Standard";
            // This is where the system detects the "Critical" value you asked about
            if (sentiment === "negative" || text.toLowerCase().includes("urgent") || text.toLowerCase().includes("down")) {
                urgency = "Critical";
            }

            // 3. Save result to Storage Table
            const entity = {
                partitionKey: "Support",
                rowKey: Date.now().toString(),
                text: text,
                sentiment: sentiment,
                urgency: urgency
            };
            await tableClient.createEntity(entity);

            // 4. TRIGGER THE LOGIC APP (The part that was missing!)
            // We use the LOGIC_APP_URL variable you already added to the portal
            if (urgency === "Critical") {
                context.log("Critical urgency detected! Sending to Logic App...");
                await axios.post(process.env.LOGIC_APP_URL, {
                    text: text,
                    urgency: urgency,
                    sentiment: sentiment
                });
            }

            return { 
                status: 201, 
                jsonBody: { success: true, urgency, sentiment } 
            };
        } catch (err) {
            context.log(`Error: ${err.message}`);
            return { status: 500, body: "Check logs for error details." };
        }
    }
});
