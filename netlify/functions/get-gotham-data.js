// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.

// Helper function to process the official NWSL roster API data
const processNWSLRosterData = (apiData) => {
    if (!apiData || !apiData.players || !Array.isArray(apiData.players)) { return []; }
    const activePlayers = apiData.players.filter(p => p.playerStatus === 'Active');
    return activePlayers.map(player => {
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
        } catch (error) { return null; }
    }).filter(p => p !== null);
};

// Helper function to process the official NWSL schedule API data
const processScheduleData = (apiData) => {
    if (!apiData || !apiData.matches || !Array.isArray(apiData.matches)) { return []; }
    const gothamMatches = apiData.matches.filter(match => match.home.shortName === "Gotham FC" || match.away.shortName === "Gotham FC");
    return gothamMatches.map(match => {
        const isHomeGame = match.home.shortName === "Gotham FC";
        const opponent = isHomeGame ? match.away.shortName : match.home.shortName;
        const broadcasters = match.editorial.broadcasters;
        const networks = [];
        if (broadcasters.broadcasterNational1) networks.push(broadcasters.broadcasterNational1.split('|')[0]);
        if (broadcasters.broadcasterNational2) networks.push(broadcasters.broadcasterNational2.split('|')[0]);
        if (broadcasters.broadcasterNational3) networks.push(broadcasters.broadcasterNational3.split('|')[0]);
        const broadcastInfo = networks.length > 0 ? networks.join(', ') : "TBD";
        return { opponent, date: match.matchDateUtc, location: match.stadiumName, broadcast: broadcastInfo, home: isHomeGame };
    });
};

// Helper function to process the NWSL GENERAL stats API data
const processStatsData = (apiData) => {
    if (!apiData || !apiData.team || !apiData.team.stats) { return null; }
    const statsArray = apiData.team.stats;
    const statsObj = {};
    statsArray.forEach(stat => {
        statsObj[stat.statsId] = { label: stat.statsLabel, value: stat.statsValue };
    });
    return statsObj;
};

// Helper function to process the NWSL standings API data
const processStandingsData = (apiData) => {
    if (!apiData || !apiData.standings || !Array.isArray(apiData.standings)) {
        return null;
    }
    const overallTable = apiData.standings.find(s => s.type === 'table');
    if (!overallTable || !overallTable.teams) {
        return null;
    }
    const gothamData = overallTable.teams.find(t => t.shortName === 'Gotham FC');
    if (!gothamData || !gothamData.stats) {
        return null;
    }
    const getStat = (statId) => gothamData.stats.find(s => s.statsId === statId)?.statsValue;
    const rank = getStat('rank');
    const points = getStat('points');
    const wins = getStat('win');
    const losses = getStat('lose');
    const draws = getStat('draw');
    if (rank === undefined || points === undefined || wins === undefined || losses === undefined || draws === undefined) {
        return null;
    }
    return { rank, points, record: `${wins}-${losses}-${draws}` };
};


exports.handler = async function(event, context) {
    // REVERTED: Using the known working Season ID for stability
    const CURRENT_SEASON_ID = "nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c"; 

    // --- API URLS ---
    const NWSL_ROSTER_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/roster?locale=en-US&seasonId=${CURRENT_SEASON_ID}`;
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${CURRENT_SEASON_ID}/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28`;
    const NWSL_STATS_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${CURRENT_SEASON_ID}/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=general`;
    const NWSL_STANDINGS_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${CURRENT_SEASON_ID}/standings/overall?locale=en-US&orderBy=rank&direction=asc`;

    const fallbackData = {
        roster: [/* Full roster data can be added here as a safety net */],
        schedule: [{ opponent: "NC Courage", date: "2025-10-26T17:00:00", location: "WakeMed Soccer Park", broadcast: "NWSL+", home: false }],
        stats: { "goals-scored": { label: "Goals scored", value: 'N/A' }, "goals-conceded": { label: "Goals conceded", value: 'N/A' } },
        standings: { rank: 'N/A', points: 'N/A', record: 'N/A' },
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

    const [roster, schedule, stats, standings] = await Promise.all([
        fetchData(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster),
        fetchData(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchData(NWSL_STATS_API_URL, processStatsData, fallbackData.stats),
        fetchData(NWSL_STANDINGS_API_URL, processStandingsData, fallbackData.standings)
    ]);
    
    // News and social are no longer part of the API response
    return {
        statusCode: 200,
        body: JSON.stringify({ roster, schedule, stats, standings })
    };
};

