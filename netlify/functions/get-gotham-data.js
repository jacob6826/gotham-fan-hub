// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.
const google = require('google-it');

// Helper function to process the official NWSL roster API data from the /roster endpoint
const processNWSLRosterData = (apiData) => {
    // Check for the top-level 'players' array
    if (!apiData || !apiData.players || !Array.isArray(apiData.players)) {
        console.error("Roster API data is missing the 'players' array.");
        return [];
    }
    const activePlayers = apiData.players.filter(p => p.playerStatus === 'Active');
    const processedPlayers = activePlayers.map(player => {
        try {
            if (!player || !player.mediaFirstName || !player.mediaLastName) return null;
            const position = player.roleLabel.replace('Attacking Midfielder', 'Midfielder').replace('Defensive Midfielder', 'Midfielder');
            const posMap = { 'Goalkeeper': 'GK', 'Defender': 'DF', 'Midfielder': 'MF', 'Forward': 'FW' };
            return {
                name: `${player.mediaFirstName} ${player.mediaLastName}`,
                pos: posMap[position] || 'N/A',
                num: player.bibNumber || 'N/A',
                bio: `${position} from ${player.nationality || 'N/A'}`
            };
        } catch (error) {
            console.error("Error processing a single player entry:", player, error);
            return null;
        }
    });
    return processedPlayers.filter(p => p !== null);
};

// Helper function to process the official NWSL schedule API data
const processScheduleData = (apiData) => {
    if (!apiData || !apiData.matches || !Array.isArray(apiData.matches)) { 
        console.error("Schedule API data is missing the 'matches' array.");
        return []; 
    }
    const gothamMatches = apiData.matches.filter(match => 
        match.home.shortName === "Gotham FC" || match.away.shortName === "Gotham FC"
    );
    return gothamMatches.map(match => {
        const isHomeGame = match.home.shortName === "Gotham FC";
        const opponent = isHomeGame ? match.away.shortName : match.home.shortName;
        const broadcasters = match.editorial.broadcasters;
        const networks = [];
        if (broadcasters.broadcasterNational1) networks.push(broadcasters.broadcasterNational1.split('|')[0]);
        if (broadcasters.broadcasterNational2) networks.push(broadcasters.broadcasterNational2.split('|')[0]);
        if (broadcasters.broadcasterNational3) networks.push(broadcasters.broadcasterNational3.split('|')[0]);
        const broadcastInfo = networks.length > 0 ? networks.join(', ') : "TBD";
        return {
            opponent: opponent,
            date: match.matchDateUtc,
            location: match.stadiumName,
            broadcast: broadcastInfo,
            home: isHomeGame
        };
    });
};

// Helper function to process the NWSL GENERAL stats API data
const processStatsData = (apiData) => {
    if (!apiData || !apiData.team || !apiData.team.stats) { 
        console.error("Stats API data is missing the 'team.stats' array.");
        return null; 
    }
    const statsArray = apiData.team.stats;
    const statsObj = {};
    statsArray.forEach(stat => {
        statsObj[stat.statsId] = { label: stat.statsLabel, value: stat.statsValue };
    });
    return statsObj;
};

// Helper function to process news search results
const processNewsData = (searchData) => {
    if (!searchData || searchData.length === 0) return [];
    return searchData.map(article => {
        let sourceName = 'News';
        try {
            const url = new URL(article.link);
            sourceName = url.hostname.replace('www.', '').split('.')[0];
            sourceName = sourceName.charAt(0).toUpperCase() + sourceName.slice(1);
        } catch (e) {
            sourceName = article.title || 'News';
        }
        const articleDate = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
        return { source: sourceName, date: articleDate, title: article.title, snippet: article.snippet, url: article.link };
    });
};

exports.handler = async function(event, context) {
    // --- API URLS ---
    const NWSL_ROSTER_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/roster?locale=en-US&seasonId=nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c';
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28`;
    const NWSL_STATS_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=general';
    const NWSL_STANDINGS_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/standings/overall?locale=en-US&orderBy=rank&direction=asc';

    // Fallback data is a safety net
    const fallbackData = {
        roster: [/* Full roster data */],
        schedule: [/* Schedule data */],
        stats: { "goals-scored": { label: "Goals scored", value: 33 }, "goals-conceded": { label: "Goals conceded", value: 22 }, "Passing Accuracy": { label: "Passing Accuracy", value: 78.65 }, "Shooting Accuracy": { label: "Shooting Accuracy", value: 51.39 } },
        standings: { rank: 3, points: 36, record: '9-7-9' },
        news: [/* News data */],
        social: [/* Social data */]
    };
    
    async function fetchData(url, processor, fallback) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const processedData = processor(data);
            if (!processedData || (Array.isArray(processedData) && processedData.length === 0 && Object.keys(processedData).length === 0)) {
                throw new Error("Processing resulted in empty data.");
            }
            return processedData;
        } catch (error) {
            console.error(`Failed to fetch live data from ${url}, using fallback.`, error);
            return fallback;
        }
    }
    
    async function fetchLiveNews() {
        try {
            const searchResults = await google({ query: "latest Gotham FC news", limit: 10 });
            return processNewsData(searchResults);
        } catch (error) {
            console.error('Failed to fetch live news, using fallback.', error);
            return fallbackData.news;
        }
    }

    // Process Standings requires a separate function because its structure is different
    const processStandingsData = (apiData) => {
        if (!apiData || !apiData.data || !apiData.data.standings) { return null; }
        const gothamStanding = apiData.data.standings.find(team => team.team.name === 'NJ/NY Gotham FC');
        if (!gothamStanding) { return null; }
        return {
            rank: gothamStanding.rank,
            points: gothamStanding.points,
            record: `${gothamStanding.wins}-${gothamStanding.losses}-${gothamStanding.draws}`
        };
    };

    const [roster, schedule, stats, standings, news] = await Promise.all([
        fetchData(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster),
        fetchData(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchData(NWSL_STATS_API_URL, processStatsData, fallbackData.stats),
        fetchData(NWSL_STANDINGS_API_URL, processStandingsData, fallbackData.standings),
        fetchLiveNews()
    ]);
    
    return {
        statusCode: 200,
        body: JSON.stringify({ roster, schedule, stats, standings, news, social: fallbackData.social })
    };
};

