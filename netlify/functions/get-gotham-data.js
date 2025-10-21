// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.

// Helper function to process the official NWSL roster API data
const processNWSLRosterData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.persons) {
        return [];
    }
    const players = apiData.data.persons;
    return players.map(player => {
        const position = player.positions && player.positions[0] ? player.positions[0].name.replace('Attacking Midfielder', 'Midfielder').replace('Defensive Midfielder', 'Midfielder') : 'N/A';
        const posMap = { 'Goalkeeper': 'GK', 'Defender': 'DF', 'Midfielder': 'MF', 'Forward': 'FW' };
        return {
            name: `${player.firstName} ${player.lastName}`,
            pos: posMap[position] || 'N/A',
            num: player.jerseyNumber || 'N/A',
            bio: `${position} from ${player.birthplace || 'N/A'}`
        };
    });
};

// Helper function to process the official NWSL schedule API data
const processScheduleData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.matches) { return []; }
    const gothamMatches = apiData.data.matches.filter(match => 
        match.homeTeam.name === "NJ/NY Gotham FC" || match.awayTeam.name === "NJ/NY Gotham FC"
    );
    return gothamMatches.map(match => {
        const isHomeGame = match.homeTeam.name === "NJ/NY Gotham FC";
        return {
            opponent: isHomeGame ? match.awayTeam.name : match.homeTeam.name,
            date: match.matchDate,
            location: match.venue.name,
            broadcast: match.broadcasts && match.broadcasts.length > 0 ? match.broadcasts.map(b => b.network.name).join(', ') : "TBD",
            home: isHomeGame
        };
    });
};

// Helper function to process the NWSL stats API data
const processStatsData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.stats) { return null; }
    const stats = apiData.data.stats;
    const goalStat = stats.find(s => s.name === 'goals');
    const assistStat = stats.find(s => s.name === 'assists');
    if (!goalStat || !assistStat || goalStat.persons.length === 0 || assistStat.persons.length === 0) { return null; }
    return {
        goalLeader: { name: `${goalStat.persons[0].firstName} ${goalStat.persons[0].lastName}`, total: goalStat.persons[0].value },
        assistLeader: { name: `${assistStat.persons[0].firstName} ${assistStat.persons[0].lastName}`, total: assistStat.persons[0].value }
    };
};


exports.handler = async function(event, context) {
    // --- API URLS (Using fixed date range for stability) ---
    const NWSL_ROSTER_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/profile?locale=en-US';
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28`;
    const NWSL_STATS_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=standard';
    
    // Fallback data is a safety net in case an API fails
    const fallbackData = {
        roster: [
            { name: "Ann-Katrin Berger", pos: "GK", num: 30, bio: "Veteran German international known for her shot-stopping." },
            { name: "Ryan Campbell", pos: "GK", num: 12, bio: "Agile young keeper drafted out of UCLA, known for quick reflexes." },
            { name: "Shelby Hogan", pos: "GK", num: 1, bio: "Provides reliable depth and experience in the goalkeeping corps." },
            { name: "Tierna Davidson", pos: "DF", num: 15, bio: "USWNT center-back and team captain, a leader in organizing the back line." },
            { name: "Jess Carter", pos: "DF", num: 27, bio: "Versatile English international who can play across the entire defensive line." },
            { name: "Emily Sonnett", pos: "DF", num: 6, bio: "Tough-tackling USWNT veteran, brings tenacity to the defense." },
            { name: "Bruninha", pos: "DF", num: 3, bio: "Dynamic Brazilian fullback known for her speed and attacking runs." },
            { name: "Lilly Reale", pos: "DF", num: 4, bio: "Promising rookie center-back from UCLA with poise beyond her years." },
            { name: "Mandy Freeman", pos: "DF", num: 22, bio: "A reliable and experienced defender, part of the club for many years." },
            { name: "Kayla Duran", pos: "DF", num: 19, bio: "Strong defensive presence, adding depth to the back line." },
            { name: "Rose Lavelle", pos: "MF", num: 16, bio: "World-class creative midfielder known for her dribbling and vision." },
            { name: "Nealy Martin", pos: "MF", num: 14, bio: "A hard-working and versatile player, able to fill in defense or midfield." },
            { name: "Sarah Schupansky", pos: "MF", num: 11, bio: "Skilled rookie midfielder with a keen eye for a final pass." },
            { name: "Taryn Torres", pos: "MF", num: 8, bio: "A technical midfielder with good passing range and field awareness." },
            { name: "Jaedyn Shaw", pos: "MF", num: 2, bio: "Exciting young USWNT talent with game-changing attacking ability." },
            { name: "Sofia Cook", pos: "MF", num: 21, bio: "A promising young midfielder with great potential." },
            { name: "Josefine Hasbo", pos: "MF", num: 5, bio: "Danish international who brings technical skill to the midfield." },
            { name: "Esther González", pos: "FW", num: 9, bio: "Clinical Spanish international striker and a proven goalscorer." },
            { name: "Midge Purce", pos: "FW", num: 23, bio: "Explosive USWNT forward known for her incredible speed and dribbling." },
            { name: "Ella Stevens", pos: "FW", num: 13, bio: "A strong and versatile forward who can play centrally or out wide." },
            { name: "Gabi Portilho", pos: "FW", num: 18, bio: "Pacy Brazilian winger who brings flair and creativity to the attack." },
            { name: "Geyse Ferreira", pos: "FW", num: 10, bio: "Dynamic Brazilian forward with a powerful shot and finishing ability." },
            { name: "Khyah Harper", pos: "FW", num: 34, bio: "A young forward with a bright future and an eye for goal." },
            { name: "Katie Stengel", pos: "FW", num: 28, bio: "Veteran NWSL forward who provides a strong presence in the box." },
            { name: "McKenna Whitham", pos: "FW", num: 17, bio: "The youngest player on the roster, a prodigious attacking talent." }
        ],
        schedule: [{ opponent: "NC Courage", date: "2025-10-26T17:00:00", location: "WakeMed Soccer Park", broadcast: "NWSL+", home: false }],
        stats: { goalLeader: { name: 'Esther González', total: 9 }, assistLeader: { name: 'Rose Lavelle', total: 6 } },
        news: [{ source: 'OneFootball', date: 'Oct 21, 2025', title: 'Gotham FC\'s International Stars Shine', snippet: 'A look at how Gotham\'s players performed...', url: 'https://onefootball.com/en/home' }],
        social: [{ user: "Gotham FC", handle: "@GothamFC", time: "2h", type: "twitter", content: "PLAYOFFS CLINCHED." }]
    };
    
    async function fetchData(url, processor, fallback) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const processedData = processor(data);
            if (!processedData || (Array.isArray(processedData) && processedData.length === 0)) {
                throw new Error("Processing resulted in empty data.");
            }
            return processedData;
        } catch (error) {
            console.error(`Failed to fetch live data from ${url}, using fallback.`, error);
            return fallback;
        }
    }
    
    const [roster, schedule, statsData] = await Promise.all([
        fetchData(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster),
        fetchData(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchData(NWSL_STATS_API_URL, processStatsData, fallbackData.stats)
    ]);
    
    const responseData = {
        roster,
        schedule,
        stats: statsData,
        news: fallbackData.news,
        social: fallbackData.social
    };

    return {
        statusCode: 200,
        body: JSON.stringify(responseData)
    };
};
