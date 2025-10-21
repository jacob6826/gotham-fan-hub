// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.
const google = require('google-it');

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

// Helper function to process news search results from google-it
const processNewsData = (searchData) => {
    if (!searchData || searchData.length === 0) {
        return [];
    }
    return searchData.map(article => {
        let sourceName = 'News Source';
        try {
            const url = new URL(article.link);
            sourceName = url.hostname.replace('www.', '').split('.')[0];
            sourceName = sourceName.charAt(0).toUpperCase() + sourceName.slice(1);
        } catch (e) {
            sourceName = article.title || 'News Source';
        }

        // Use current date as publication time is not available from this library
        const articleDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

        return {
            source: sourceName,
            date: articleDate,
            title: article.title,
            snippet: article.snippet,
            url: article.link
        };
    });
};


exports.handler = async function(event, context) {
    // --- API URLS ---
    const NWSL_ROSTER_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/profile?locale=en-US';
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28`;
    const NWSL_STATS_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=standard';
    
    // Fallback data is a safety net in case an API fails
    const fallbackData = {
        roster: [
            { name: "Ann-Katrin Berger", pos: "GK", num: 30, bio: "Veteran German international known for her shot-stopping." }
        ],
        schedule: [{ opponent: "NC Courage", date: "2025-10-26T17:00:00", location: "WakeMed Soccer Park", broadcast: "NWSL+", home: false }],
        stats: { goalLeader: { name: 'Esther González', total: 9 }, assistLeader: { name: 'Rose Lavelle', total: 6 } },
        news: [
            { source: 'The Athletic', date: 'Oct 21, 2025', title: 'Deep Dive: The Tactical Genius Behind Gotham\'s Midfield', snippet: 'Juan Carlos Amorós has built a formidable midfield trio...', url: 'https://theathletic.com/nwsl/' }
        ],
        social: [
            { user: "Gotham FC", handle: "@GothamFC", time: "2h", type: "twitter", content: "PLAYOFFS CLINCHED." }
        ]
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
    
    // Updated Function to fetch live news using google-it
    async function fetchLiveNews() {
        try {
            const searchResults = await google({ query: "latest Gotham FC news", limit: 10 });
            const processedNews = processNewsData(searchResults);
            if (processedNews.length === 0) throw new Error("No news articles found.");
            return processedNews;
        } catch (error) {
            console.error('Failed to fetch live news, using fallback.', error);
            return fallbackData.news;
        }
    }

    const [roster, schedule, statsData, news] = await Promise.all([
        fetchData(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster),
        fetchData(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchData(NWSL_STATS_API_URL, processStatsData, fallbackData.stats),
        fetchLiveNews()
    ]);
    
    const responseData = {
        roster,
        schedule,
        stats: statsData,
        news,
        social: fallbackData.social // Social feed still uses fallback
    };

    return {
        statusCode: 200,
        body: JSON.stringify(responseData)
    };
};

