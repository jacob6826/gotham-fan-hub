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
            opponent: isHomeGame ? match.awayTeam.name : match.awayTeam.name,
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

    // Helper to find and format a specific stat
    const getStatLeaders = (data, statName, count = 3) => {
        if (!data || !data.data || !data.data.stats) return [];
        const stat = data.data.stats.find(s => s.name === statName);
        if (!stat || !stat.persons || stat.persons.length === 0) return [];
        return stat.persons.slice(0, count).map(p => ({
            name: `${p.firstName} ${p.lastName}`,
            total: p.value
        }));
    };

    // Process each category
    const standardData = statsResponses.find(r => r.category === 'standard')?.data;
    const shootingData = statsResponses.find(r => r.category === 'shooting')?.data;
    const passingData = statsResponses.find(r => r.category === 'passing')?.data;
    const defendingData = statsResponses.find(r => r.category === 'defending')?.data;

    if (standardData) {
        processedStats.goalLeaders = getStatLeaders(standardData, 'goals');
        processedStats.assistLeaders = getStatLeaders(standardData, 'assists');
    }
    if (shootingData) {
        processedStats.shotLeaders = getStatLeaders(shootingData, 'shots');
        processedStats.sotLeaders = getStatLeaders(shootingData, 'shotsOnTarget');
    }
    if (passingData) {
        processedStats.passLeaders = getStatLeaders(passingData, 'successfulPasses');
    }
    if (defendingData) {
        processedStats.tackleLeaders = getStatLeaders(defendingData, 'tacklesWon');
        processedStats.interceptionLeaders = getStatLeaders(defendingData, 'interceptions');
    }

    return processedStats;
};


exports.handler = async function(event, context) {
    const NWSL_ROSTER_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/profile?locale=en-US';
    const NWSL_SCHEDULE_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28';
    const NWSL_STATS_BASE_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=';

    // Placeholder data remains as a robust fallback
    const fallbackData = {
        roster: [/* Full roster data */],
        schedule: [/* Schedule data */],
        stats: { goalLeaders: [{name: 'Esther González', total: 9}], assistLeaders: [{name: 'Rose Lavelle', total: 6}] },
        news: [/* News data */],
        social: [/* Social data */]
    };
    
    async function fetchData(url, processor, fallback) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const processedData = processor(data);
            if (!processedData || (Array.isArray(processedData) && processedData.length === 0)) throw new Error("Processing resulted in empty data.");
            return processedData;
        } catch (error) {
            console.error(`Failed to fetch live data from ${url}, using fallback.`, error);
            return fallback;
        }
    }
    
    async function fetchAllStats() {
        const categories = ['standard', 'shooting', 'passing', 'defending'];
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

    const [roster, schedule, stats] = await Promise.all([
        fetchData(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster),
        fetchData(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchAllStats()
    ]);
    
    const responseData = {
        roster,
        schedule,
        stats,
        news: fallbackData.news, // News and social will use fallbacks for now
        social: fallbackData.social
    };

    return {
        statusCode: 200,
        body: JSON.stringify(responseData)
    };
};

