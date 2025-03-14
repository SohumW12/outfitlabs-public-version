const express = require("express");
const mongoose = require("mongoose");
const passport = require("passport");
const session = require("express-session");
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const multer = require("multer");
const axios = require("axios");
const zipcodes = require("zipcodes");
const path = require("path");
const moment = require("moment-timezone");
require("dotenv").config();
const { getDeepSeekResponse } = require("./deepseek");

const app = express();

mongoose.connect(process.env.MONGO_URI, {
    useNewUrlParser: true,
    useUnifiedTopology: true
})
.then(() => console.log("✅ Connected to MongoDB"))

app.use(session({
    secret: "supersecretkey",
    resave: false,
    saveUninitialized: false,
    cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(passport.initialize());
app.use(passport.session());

const Clothing = mongoose.model("Clothing", new mongoose.Schema({
    userId: String,
    name: String,
    mainCategory: {
        type: String,
        enum: ['tops', 'bottoms', 'outerwear', 'footwear', 'accessories'],
        required: true
    },
    subCategory: String, 
    style: String, 
    fit: String,  
    size: String,
    color: String,
    image: String,
    season: {
        type: [String],
        default: ['spring', 'summer', 'fall', 'winter']
    }
}));

const User = mongoose.model("User", new mongoose.Schema({
    googleId: String,
    displayName: String,
    latitude: Number,
    longitude: Number,
    timezone: String
}));

const SavedOutfit = mongoose.model("SavedOutfit", new mongoose.Schema({
    userId: String,
    date: { type: Date, required: true },
    name: String,
    items: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Clothing' }],
    weather: Object,
    stylingTips: String
}));

passport.use(new GoogleStrategy({
    clientID: process.env.GOOGLE_CLIENT_ID,
    clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    callbackURL: process.env.GOOGLE_CALLBACK_URL
}, async (accessToken, refreshToken, profile, done) => {
    try {
        let user = await User.findOne({ googleId: profile.id });
        if (!user) {
            user = await new User({
                googleId: profile.id,
                displayName: profile.displayName
            }).save();
        }
        done(null, user);
    } catch (err) {
        done(err);
    }
}));

passport.serializeUser((user, done) => done(null, user.id));
passport.deserializeUser(async (id, done) => {
    try {
        const user = await User.findById(id);
        done(null, user);
    } catch (err) {
        done(err);
    }
});

app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const storage = multer.diskStorage({
    destination: "public/uploads/",
    filename: (req, file, cb) => cb(null, Date.now() + path.extname(file.originalname))
});
const upload = multer({ storage });

const clothingOptions = {
    tops: {
        subCategories: ['t-shirt', 'polo', 'dress shirt', 'button-up', 'blouse', 'tank top', 'quarterzip', 'sweater', 'long sleeve', 'short sleeve', 'sports shirt', 'henley', 'turtleneck'],
        fits: ['slim', 'regular', 'loose', 'oversized', 'fitted', 'athletic', 'classic'],
        styles: ['casual', 'formal', 'athletic', 'business', 'vintage', 'graphic', 'plain', 'patterned', 'striped']
    },
    bottoms: {
        subCategories: ['jeans', 'sweatpants', 'shorts', 'khakis', 'dress pants', 'chinos', 'joggers', 'leggings', 'skirt', 'cargo pants', 'track pants'],
        fits: ['skinny', 'slim', 'regular', 'relaxed', 'baggy', 'straight', 'bootcut', 'wide-leg', 'tapered'],
        styles: ['casual', 'formal', 'athletic', 'distressed', 'high-waisted', 'low-rise', 'pleated', 'flat-front']
    },
    outerwear: {
        subCategories: ['jacket', 'coat', 'puffer', 'windbreaker', 'blazer', 'hoodie', 'sweater', 'vest', 'cardigan', 'bomber', 'fleece', 'raincoat', 'parka'],
        fits: ['slim', 'regular', 'oversized', 'fitted', 'boxy', 'cropped'],
        styles: ['casual', 'formal', 'athletic', 'waterproof', 'lightweight', 'heavy', 'insulated', 'quilted']
    },
    footwear: {
        subCategories: ['sneakers', 'dress shoes', 'boots', 'sandals', 'loafers', 'athletic shoes', 'running shoes', 'slip-ons', 'hiking shoes', 'basketball shoes', 'casual shoes'],
        fits: ['narrow', 'regular', 'wide', 'extra wide'],
        styles: ['casual', 'formal', 'athletic', 'waterproof', 'high-top', 'low-top', 'platform', 'flat']
    },
    accessories: {
        subCategories: ['hat', 'scarf', 'gloves', 'socks', 'belt', 'tie', 'watch', 'sunglasses', 'jewelry', 'bag', 'backpack', 'beanie', 'cap'],
        fits: ['one size', 'adjustable', 'small', 'medium', 'large'],
        styles: ['casual', 'formal', 'athletic', 'seasonal', 'statement', 'minimalist']
    }
};
app.get("/user-location", async (req, res) => {
    if (!req.user) return res.json({ error: "User not logged in" });

    const user = await User.findById(req.user.id);
    if (!user) return res.json({ error: "User not found" });

    res.json({ latitude: user.latitude, longitude: user.longitude });
});

async function getWeather(user, date) {
    try {
        const timezone = user.timezone || 'America/New_York';
        const targetDate = moment.tz(date, timezone);
        
        const gridResponse = await axios.get(
            `https://api.weather.gov/points/${user.latitude},${user.longitude}`,
            { headers: { "User-Agent": "Outfitlabs/1.0 (test@email.com)" } } //weather api requires this for some reason
        );

        const forecastResponse = await axios.get(
            gridResponse.data.properties.forecast,
            { headers: { "User-Agent": "Outfitlabs/1.0 (test@email.com)" } } //weather api requires this for some reason
        );

        const periods = forecastResponse.data.properties.periods.filter(p => 
            moment.tz(p.startTime, timezone).isSame(targetDate, 'day')
        );

        if (periods.length === 0) return null;

        const temps = periods.map(p => p.temperature);
        return {
            date: targetDate.format('YYYY-MM-DD'),
            condition: [...new Set(periods.map(p => p.shortForecast))].join(' / '),
            minTemp: Math.min(...temps),
            maxTemp: Math.max(...temps),
            isDaytime: periods.some(p => p.isDaytime)
        };
    } catch (error) {
        console.error("❌ Weather Error:", error.message);
        return null;
    }
}

function categorizeClothes(clothes) {
    const categories = {
        tops: [],
        bottoms: [],
        outerwear: [],
        footwear: [],
        accessories: []
    };
    
    clothes.forEach(item => {
        if (categories.hasOwnProperty(item.mainCategory)) {
            categories[item.mainCategory].push(item);
        }
    });
    
    return categories;
}

app.get("/", async (req, res) => {
    const clothes = req.user ? await Clothing.find({ userId: req.user.id }) : [];
    res.render("index", { 
        user: req.user, 
        clothes, 
        activeTab: 'generator',
        clothingOptions
    });
});

app.get("/calendar", async (req, res) => {
    if (!req.user) return res.redirect("/");
    
    const clothes = await Clothing.find({ userId: req.user.id });
    const savedOutfits = await SavedOutfit.find({ userId: req.user.id }).populate('items');
    
    res.render("index", { 
        user: req.user, 
        clothes, 
        savedOutfits,
        activeTab: 'calendar',
        clothingOptions
    });
});

app.get("/clothing-options", (req, res) => {
    const { category } = req.query;
    if (category && clothingOptions[category]) {
        res.json(clothingOptions[category]);
    } else {
        res.json({ error: "Invalid category" });
    }
});

app.get("/auth/google", passport.authenticate("google", { scope: ["profile"] }));

app.get("/auth/google/callback", passport.authenticate("google", { 
    successRedirect: "/", 
    failureRedirect: "/" 
}));

app.get("/logout", (req, res) => {
    req.logout(() => res.redirect("/"));
});

app.post("/update-location", async (req, res) => {
    if (!req.user) return res.status(401).send("Unauthorized");

    try {
        const updates = {};
        if (req.body.zip) {
            const location = zipcodes.lookup(req.body.zip);
            if (!location) return res.status(400).json({ error: "Invalid ZIP code" });
            updates.latitude = location.latitude;
            updates.longitude = location.longitude;
            updates.timezone = location.timezone;
        } else {
            updates.latitude = req.body.latitude;
            updates.longitude = req.body.longitude;
        }
        await User.findByIdAndUpdate(req.user.id, updates);
        res.redirect("/");
    } catch (error) {
        res.status(500).json({ error: "Location update failed" });
    }
});

app.post("/upload", upload.single("image"), async (req, res) => {
    if (!req.user) return res.redirect("/");
    
    try {
        await new Clothing({
            userId: req.user.id,
            name: req.body.name.trim(),
            mainCategory: req.body.mainCategory,
            subCategory: req.body.subCategory,
            style: req.body.style,
            fit: req.body.fit,
            size: req.body.size.trim().toUpperCase(),
            color: req.body.color,
            season: req.body.season ? (Array.isArray(req.body.season) ? req.body.season : [req.body.season]) : ['spring', 'summer', 'fall', 'winter'],
            image: "/uploads/" + req.file.filename
        }).save();
        res.redirect("/");
    } catch (error) {
        console.error("Upload error:", error);
        res.status(500).send("Upload failed");
    }
});

app.post("/generate", async (req, res) => {
    try {
        if (!req.user) return res.json({ success: false, message: "Login required" });

        const { dates, notes } = req.body;
        if (!dates?.length) return res.json({ success: false, message: "Select dates" });

        const user = await User.findById(req.user.id);
        if (!user.latitude || !user.longitude) {
            return res.json({ success: false, message: "Update location first" });
        }

        const clothes = await Clothing.find({ userId: user.id });
        if (clothes.length === 0) {
            return res.json({ success: false, message: "Upload clothes first" });
        }

        const weatherData = (await Promise.all(
            dates.map(date => getWeather(user, date))
        )).filter(Boolean);

        const categorized = categorizeClothes(clothes);
        
        const prompts = weatherData.map(weather => {
            const isRainy = weather.condition.toLowerCase().includes('rain') || 
                            weather.condition.toLowerCase().includes('storm');
            const isSnowy = weather.condition.toLowerCase().includes('snow');
            const isCold = weather.minTemp < 50;
            const isHot = weather.maxTemp > 75;
            
            const topsList = categorized.tops.map(c => 
                `${c.name} (${c.subCategory}, ${c.size}, ${c.color || 'unspecified color'}, ${c.fit || 'regular fit'})`
            ).join(", ");
            
            const bottomsList = categorized.bottoms.map(c => 
                `${c.name} (${c.subCategory}, ${c.size}, ${c.color || 'unspecified color'}, ${c.fit || 'regular fit'})`
            ).join(", ");
            
            const outerwearList = categorized.outerwear.map(c => 
                `${c.name} (${c.subCategory}, ${c.size}, ${c.color || 'unspecified color'}, ${c.fit || 'regular fit'})`
            ).join(", ");
            
            const footwearList = categorized.footwear.map(c => 
                `${c.name} (${c.subCategory}, ${c.size}, ${c.color || 'unspecified color'})`
            ).join(", ");
            
            const accessoriesList = categorized.accessories.map(c => 
                `${c.name} (${c.subCategory}, ${c.size || 'one size'}, ${c.color || 'unspecified color'})`
            ).join(", ");

            let weatherGuidance = "";
            if (isRainy) {
                weatherGuidance = "Include waterproof or water-resistant items. Prioritize items that keep the person dry.";
            } else if (isSnowy) {
                weatherGuidance = "Prioritize warm, insulated items and waterproof footwear.";
            } else if (isCold) {
                weatherGuidance = "Focus on layering and warmth. Include appropriate outerwear.";
            } else if (isHot) {
                weatherGuidance = "Select lightweight, breathable clothing suitable for hot weather.";
            }
            
            return `Create a complete outfit for ${weather.date} with weather: ${weather.condition} (${weather.minTemp}°F-${weather.maxTemp}°F).

AVAILABLE CLOTHING:
- TOPS: ${topsList || "None available"}
- BOTTOMS: ${bottomsList || "None available"}
- OUTERWEAR: ${outerwearList || "None available"}
- FOOTWEAR: ${footwearList || "None available"}
- ACCESSORIES: ${accessoriesList || "None available"}

OUTFIT REQUIREMENTS:
1. Select ONE top, ONE bottom, and appropriate outerwear for the temperature - If the user needs it to be formal include formal wear like blazers etc
2. Select ONE footwear option appropriate for the weather
3. Include 1-2 accessories if available and appropriate
5. Create a cohesive outfit with matching colors and styles
6: Be professional but be creative so choose a different outfit everytime not the same pants or shirt etc as long as it makes sense
7: HERE ARE SPECIFIC NOTES FROM THE USER - FOLLOW THESE - ${notes}
STYLING GUIDANCE:
- Provide specific advice for this outfit (e.g., "Tuck in the shirt", "Roll up the sleeves")
- Include weather-specific styling tips (e.g., "Bring umbrella", "Layer for changing temperatures")
- Suggest how to wear the items together for best comfort and style

RESPONSE FORMAT:
Outfit: [Creative Name But Not Corny]
Items: [item1], [item2], [item3], [item4]
Styling: [3 specific styling tips]

DO NOT make up items that are not in the lists. Use ONLY the exact item names provided.
NO BOLD SO DONT GIVE ME THE ** BS I DONT WANNA SEE IT
`;
        });

        const aiResponses = await Promise.all(
            prompts.map(prompt => getDeepSeekResponse(prompt))
        );

        const outfits = aiResponses.map((response, index) => {
            try {
                const outfitMatch = response.match(/Outfit:\s*(.*?)(?:\r?\n|$)/);
                const itemsMatch = response.match(/Items:\s*(.*?)(?:\r?\n|$)/);
                const stylingMatch = response.match(/Styling:\s*(.*?)(?:\r?\n|$)/s);
                
                const outfitName = outfitMatch ? outfitMatch[1].trim() : "Outfit";
                const itemsList = itemsMatch ? itemsMatch[1].split(',').map(s => s.trim()) : [];
                const stylingTips = stylingMatch ? stylingMatch[1].trim() : "";
                
                const matchedItems = [];
                const usedMainCategories = new Set();
                
                itemsList.forEach(itemName => {
                    let bestMatch = null;
                    let highestMatchScore = 0;
                    
                    clothes.forEach(item => {
                        if (usedMainCategories.has(item.mainCategory)) return;
                        
                        const itemNameLower = item.name.toLowerCase();
                        const searchNameLower = itemName.toLowerCase();
                        
                        let matchScore = 0;
                        if (itemNameLower === searchNameLower) matchScore = 100;
                        else if (itemNameLower.includes(searchNameLower)) matchScore = 80;
                        else if (searchNameLower.includes(itemNameLower)) matchScore = 70;
                        
                        if (matchScore > highestMatchScore) {
                            highestMatchScore = matchScore;
                            bestMatch = item;
                        }
                    });
                    
                    if (bestMatch && highestMatchScore > 0) {
                        usedMainCategories.add(bestMatch.mainCategory);
                        matchedItems.push(bestMatch);
                    }
                });

                return {
                    date: weatherData[index].date,
                    weather: weatherData[index],
                    name: outfitName,
                    items: matchedItems,
                    stylingTips: stylingTips,
                    raw: response
                };
            } catch (error) {
                console.error("❌ Response Parsing Error:", response);
                return {
                    date: weatherData[index].date,
                    weather: weatherData[index],
                    name: "Failed to generate outfit",
                    items: [],
                    stylingTips: "",
                    error: true
                };
            }
        });

        res.json({ success: true, outfits });
    } catch (error) {
        console.error("❌ Generation Error:", error);
        res.status(500).json({ success: false, message: "Server error" });
    }
});
app.post("/custom-generate", async (req, res) => {
    try {
        if (!req.user) return res.json({ success: false, message: "Login required" });

        const { preferences, weather, temperature } = req.body;
        if (!preferences && !weather && !temperature) {
            return res.json({ success: false, message: "Provide at least one input for generation" });
        }

        const user = await User.findById(req.user.id);
        const clothes = await Clothing.find({ userId: user.id });

        if (clothes.length === 0) {
            return res.json({ success: false, message: "Upload clothes first" });
        }

        const categorized = categorizeClothes(clothes);

        const prompt = `
Create a complete outfit based on the following user input:

USER PREFERENCES: "${preferences || 'No specific preferences'}"
WEATHER: "${weather || 'No specific condition provided'}"
TEMPERATURE: "${temperature ? temperature + '°F' : 'No specific temperature provided'}"

AVAILABLE CLOTHING:
- TOPS: ${categorized.tops.map(c => `${c.name} (${c.subCategory}, ${c.size})`).join(", ") || "None available"}
- BOTTOMS: ${categorized.bottoms.map(c => `${c.name} (${c.subCategory}, ${c.size})`).join(", ") || "None available"}
- OUTERWEAR: ${categorized.outerwear.map(c => `${c.name} (${c.subCategory}, ${c.size})`).join(", ") || "None available"}
- FOOTWEAR: ${categorized.footwear.map(c => `${c.name} (${c.subCategory}, ${c.size})`).join(", ") || "None available"}
- ACCESSORIES: ${categorized.accessories.map(c => `${c.name} (${c.subCategory}, ${c.size})`).join(", ") || "None available"}

OUTFIT REQUIREMENTS:
1. Select ONE top, ONE bottom, and appropriate outerwear if necessary.
2. Select suitable footwear for the weather.
3. Include 1-2 accessories if available.
4. Outfit must be stylish and match color-wise.
5. Be professional but creative—generate different outfits each time.
6. Follow user preferences strictly.

STYLING GUIDANCE:
- Provide 3 specific tips for styling the outfit.

RESPONSE FORMAT:
Outfit: [Creative Name But Not Corny]
Items: [item1], [item2], [item3], [item4]
Styling: [3 specific styling tips]
DO NOT make up items. Use only the provided clothing list.

NO BOLD SO DONT GIVE ME THE ** BS I DONT WANNA SEE IT
        `;

        const aiResponse = await getDeepSeekResponse(prompt);

        try {
            const outfitMatch = aiResponse.match(/Outfit:\s*(.*?)(?:\r?\n|$)/);
            const itemsMatch = aiResponse.match(/Items:\s*(.*?)(?:\r?\n|$)/);
            const stylingMatch = aiResponse.match(/Styling:\s*(.*?)(?:\r?\n|$)/s);

            const outfitName = outfitMatch ? outfitMatch[1].trim() : "Outfit";
            const itemsList = itemsMatch ? itemsMatch[1].split(',').map(s => s.trim()) : [];
            const stylingTips = stylingMatch ? stylingMatch[1].trim() : "";

            const matchedItems = [];
            const usedCategories = new Set();

            itemsList.forEach(itemName => {
                let bestMatch = null;
                let highestMatchScore = 0;

                clothes.forEach(item => {
                    if (usedCategories.has(item.mainCategory)) return;

                    const itemNameLower = item.name.toLowerCase();
                    const searchNameLower = itemName.toLowerCase();

                    let matchScore = 0;
                    if (itemNameLower === searchNameLower) matchScore = 100;
                    else if (itemNameLower.includes(searchNameLower)) matchScore = 80;
                    else if (searchNameLower.includes(itemNameLower)) matchScore = 70;

                    if (matchScore > highestMatchScore) {
                        highestMatchScore = matchScore;
                        bestMatch = item;
                    }
                });

                if (bestMatch && highestMatchScore > 0) {
                    usedCategories.add(bestMatch.mainCategory);
                    matchedItems.push(bestMatch);
                }
            });

            return res.json({
                success: true,
                outfits: [{
                    weather: { condition: weather || "Not specified", temperature: temperature || "Not provided" },
                    name: outfitName,
                    items: matchedItems,
                    stylingTips: stylingTips,
                    raw: aiResponse
                }]
            });

        } catch (error) {
            console.error("❌ Parsing Error:", aiResponse);
            return res.json({
                success: false,
                message: "Failed to generate outfit. Try again later."
            });
        }

    } catch (error) {
        console.error("❌ Custom Generation Error:", error);
        return res.status(500).json({ success: false, message: "Server error" });
    }
});

app.post("/save-to-calendar", async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, message: "Login required" });
        
        const { date, outfitName, itemIds, weather, stylingTips } = req.body;
        
        if (!date || !outfitName || !itemIds || !Array.isArray(itemIds)) {
            return res.status(400).json({ success: false, message: "Invalid data" });
        }
        
        const existingOutfit = await SavedOutfit.findOne({ 
            userId: req.user.id,
            date: new Date(date)
        });
        
        if (existingOutfit) {
            existingOutfit.name = outfitName;
            existingOutfit.items = itemIds;
            existingOutfit.weather = weather;
            existingOutfit.stylingTips = stylingTips;
            await existingOutfit.save();
        } else {
            await new SavedOutfit({
                userId: req.user.id,
                date: new Date(date),
                name: outfitName,
                items: itemIds,
                weather: weather,
                stylingTips: stylingTips
            }).save();
        }
        
        res.json({ success: true });
    } catch (error) {
        console.error("❌ Save Error:", error);
        res.status(500).json({ success: false, message: "Failed to save outfit" });
    }
});

app.get("/calendar-outfits/:year/:month", async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, message: "Login required" });
        
        const { year, month } = req.params;
        const startDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        const endDate = new Date(parseInt(year), parseInt(month), 0);
        
        const outfits = await SavedOutfit.find({
            userId: req.user.id,
            date: { $gte: startDate, $lte: endDate }
        }).populate('items');
        
        res.json({ success: true, outfits });
    } catch (error) {
        console.error("❌ Calendar Error:", error);
        res.status(500).json({ success: false, message: "Failed to fetch calendar" });
    }
});

app.delete("/calendar-outfit/:id", async (req, res) => {
    try {
        if (!req.user) return res.status(401).json({ success: false, message: "Login required" });
        
        const outfit = await SavedOutfit.findById(req.params.id);
        if (!outfit || outfit.userId !== req.user.id) {
            return res.status(404).json({ success: false, message: "Outfit not found" });
        }
        
        await SavedOutfit.findByIdAndDelete(req.params.id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ success: false, message: "Failed to delete outfit" });
    }
});

app.listen(process.env.PORT, () => {
    console.log(`✅ Server running on port ${process.env.PORT}`);
});
