//actually openai but too lkazy to change file name n stuff
const OpenAI = require("openai");
require("dotenv").config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY, // i have $2 left in credits lwk broke
});

async function getDeepSeekResponse(prompt) {
    try {
        const completion = await openai.chat.completions.create({
            model: "gpt-4o-mini", 
            messages: [
                { role: "system", content: "You are an AI stylist suggesting outfits based on the weather and available clothes." },
                { role: "user", content: prompt }
            ],
            temperature: 0.5,
        });

        return completion.choices[0].message.content.trim();
    } catch (error) {
        console.error("OpenAI API Error:", error.message);
        return "Error generating outfit. Please try again.";
    }
}

module.exports = { getDeepSeekResponse };
