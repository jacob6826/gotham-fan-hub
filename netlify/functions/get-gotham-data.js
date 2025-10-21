// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.
const google = require('google-it');

// Helper function to process the official NWSL roster API data
const processNWSLRosterData = (apiData) => {
    // The /roster endpoint has data under `data.roster`
    if (!apiData || !apiData.data || !apiData.data.roster) {
        return [];
    }
    const players = apiData.data.roster;
    return players.map(playerEntry => {
        const player = playerEntry.person;
        const positionInfo = playerEntry.position;
        const position = positionInfo ? positionInfo.name.replace('Attacking Midfielder', 'Midfielder').replace('Defensive Midfielder', 'Midfielder') : 'N/A';
        const posMap = { 'Goalkeeper': 'GK', 'Defender': 'DF', 'Midfielder': 'MF', 'Forward': 'FW' };
        
        return {
            name: `${player.firstName} ${player.lastName}`,
            pos: posMap[position] || 'N/A',
            num: playerEntry.jerseyNumber || 'N/A',
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

// Helper function to process MULTIPLE stats categories from the NWSL API
const processStatsData = (statsResponses) => {
    const processedStats = {};

    // Helper to find and format a specific stat leader list
    const getStatLeaders = (data, statName, count = 3) => {
        if (!data || !data.data || !data.data.stats) return [];
        const stat = data.data.stats.find(s => s.name === statName);
        if (!stat || !stat.persons || stat.persons.length === 0) return [];
        return stat.persons.slice(0, count).map(p => ({
            name: `${p.firstName} ${p.lastName}`,
            total: p.value
        }));
    };
    
    // Helper to get a single stat object for team-level data
    const getStat = (data, statName) => {
        if (!data || !data.data || !data.data.stats) return null;
        return data.data.stats.find(s => s.name === statName);
    };

    // Process each category
    const standardData = statsResponses.find(r => r.category === 'standard')?.data;
    const shootingData = statsResponses.find(r => r.category === 'shooting')?.data;
    const passingData = statsResponses.find(r => r.category === 'passing')?.data;
    const defendingData = statsResponses.find(r => r.category === 'defending')?.data;
    const goalkeepingData = statsResponses.find(r => r.category === 'goalkeeping')?.data;

    if (standardData) {
        processedStats.goalLeaders = getStatLeaders(standardData, 'goals');
        processedStats.assistLeaders = getStatLeaders(standardData, 'assists');
        processedStats.cornerLeaders = getStatLeaders(standardData, 'corners');
    }
    if (shootingData) {
        processedStats.shotLeaders = getStatLeaders(shootingData, 'shots');
        processedStats.sotLeaders = getStatLeaders(shootingData, 'shotsOnTarget');
        const pkAttemptsStat = getStat(shootingData, 'penaltyKickAttempts');
        const pkGoalsStat = getStat(shootingData, 'penaltyKickGoals');
        if (pkAttemptsStat && pkGoalsStat && pkAttemptsStat.team.value > 0) {
            processedStats.penaltyKickPercentage = { total: (pkGoalsStat.team.value / pkAttemptsStat.team.value) * 100 };
        }
    }
    if (passingData) {
        processedStats.passLeaders = getStatLeaders(passingData, 'successfulPasses');
        const successfulPassesStat = getStat(passingData, 'successfulPasses');
        const passesAttemptedStat = getStat(passingData, 'passesAttempted');
        if (successfulPassesStat && passesAttemptedStat && passesAttemptedStat.team.value > 0) {
            processedStats.passingAccuracy = { total: (successfulPassesStat.team.value / passesAttemptedStat.team.value) * 100 };
        }
    }
    if (defendingData) {
        processedStats.tackleLeaders = getStatLeaders(defendingData, 'tacklesWon');
        processedStats.interceptionLeaders = getStatLeaders(defendingData, 'interceptions');
        processedStats.headedDuelLeaders = getStatLeaders(defendingData, 'headedDuelsWon');
    }
    if (goalkeepingData) {
        const goalsConcededStat = getStat(goalkeepingData, 'goalsConceded');
        if (goalsConcededStat) {
            processedStats.goalsConceded = { total: goalsConcededStat.team.value };
        }
    }

    return processedStats;
};

// Helper function to process the NWSL standings API data
const processStandingsData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.standings) { return null; }
    const gothamStanding = apiData.data.standings.find(team => team.team.name === 'NJ/NY Gotham FC');
    if (!gothamStanding) { return null; }
    return {
        rank: gothamStanding.rank,
        points: gothamStanding.points,
        record: `${gothamStanding.wins}-${gothamStanding.losses}-${gothamStanding.draws}` // W-L-D
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
    const NWSL_ROSTER_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/roster?locale=en-US&seasonId=nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c';
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28`;
    const NWSL_STATS_BASE_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=';
    const NWSL_STANDINGS_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/standings/overall?locale=en-US&orderBy=rank&direction=asc';
    
    // Fallback data is a safety net in case an API fails
    const fallbackData = {
        roster: [ /* Full roster data */ ],
        schedule: [{ opponent: "NC Courage", date: "2025-10-26T17:00:00", location: "WakeMed Soccer Park", broadcast: "NWSL+", home: false }],
        stats: { goalLeaders: [{ name: 'Esther González', total: 9 }], assistLeaders: [{ name: 'Rose Lavelle', total: 6 }] },
        standings: { rank: 3, points: 38, record: '10-6-8' },
        news: [ /* News data */ ],
        social: [ /* Social data */ ]
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
    
    async function fetchAllStats() {
        const categories = ['standard', 'shooting', 'passing', 'defending', 'goalkeeping'];
        try {
            const statPromises = categories.map(category => 
                fetch(NWSL_STATS_BASE_URL + category).then(res => res.json()).then(data => ({category, data}))
            );
            const statsResponses = await Promise.all(statPromises);
            return processStatsData(statsResponses);
        } catch (error) {
            console.error('Failed to fetch some or all stats categories, using fallback.', error);
            return fallbackData.stats;
        }
    }
    
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

    const [roster, schedule, stats, standings, news] = await Promise.all([
        fetchData(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster),
        fetchData(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchAllStats(),
        fetchData(NWSL_STANDINGS_API_URL, processStandingsData, fallbackData.standings),
        fetchLiveNews()
    ]);
    
    const responseData = {
        roster,
        schedule,
        stats,
        standings,
        news,
        social: fallbackData.social // Social feed still uses fallback
    };

    return {
        statusCode: 200,
        body: JSON.stringify(responseData)
    };
};

