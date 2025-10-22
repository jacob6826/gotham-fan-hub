// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.
const csv = require('csv-parser');
const stream = require('stream');

// Helper function to normalize names for more reliable matching
const normalizeName = (name) => {
    if (!name) return '';
    return name.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
};

// Helper function to process the official NWSL roster API data and enrich it with sheet data
const processNWSLRosterData = (apiData, enrichmentData) => {
    if (!apiData || !apiData.players || !Array.isArray(apiData.players)) { 
        console.error("Roster API data is missing the 'players' array.");
        return []; 
    }
    const activePlayers = apiData.players.filter(p => p.playerStatus === 'Active');
    
    return activePlayers.map(player => {
        try {
            if (!player || !player.mediaFirstName || !player.mediaLastName) return null;
            
            const potentialKeys = [
                normalizeName(player.shirtName),
                normalizeName(player.shortName),
                normalizeName(player.mediaLastName)
            ].filter(key => key);

            let enriched = {};
            for (const key of potentialKeys) {
                if (enrichmentData[key]) {
                    enriched = enrichmentData[key];
                    break;
                }
            }

            const position = player.roleLabel.replace('Attacking Midfielder', 'Midfielder').replace('Defensive Midfielder', 'Midfielder');
            const posMap = { 'Goalkeeper': 'GK', 'Defender': 'DF', 'Midfielder': 'MF', 'Forward': 'FW' };
            
            return {
                name: `${player.mediaFirstName} ${player.mediaLastName}`,
                pos: posMap[position] || 'N/A',
                num: player.bibNumber || 'N/A',
                bio: `${position} from ${player.nationality || 'N/A'}`,
                headshot: enriched.headshotUrl || null,
                pageUrl: enriched.playerPageUrl || null
            };
        } catch (error) { 
            console.error("Error processing a single player entry:", player, error);
            return null;
        }
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

// Helper function to process MULTIPLE stats categories from the NWSL API
const processAllStatsData = (statsResponses) => {
    const processedStats = {};

    // First, get all team-level stats from the 'general' category
    const generalData = statsResponses.find(r => r.category === 'general')?.data;
    if (generalData && generalData.team && generalData.team.stats) {
        generalData.team.stats.forEach(stat => {
            processedStats[stat.statsId] = { label: stat.statsLabel, value: stat.statsValue };
        });
    }

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

    // Get player leader data from other categories
    const standardData = statsResponses.find(r => r.category === 'standard')?.data;
    const shootingData = statsResponses.find(r => r.category === 'shooting')?.data;
    const defendingData = statsResponses.find(r => r.category === 'defending')?.data;

    if (standardData) {
        processedStats.goalLeaders = getStatLeaders(standardData, 'goals');
        processedStats.assistLeaders = getStatLeaders(standardData, 'assists');
    }
    if (shootingData) {
        processedStats.shotLeaders = getStatLeaders(shootingData, 'shots');
    }
    if (defendingData) {
        processedStats.tackleLeaders = getStatLeaders(defendingData, 'tacklesWon');
        processedStats.interceptionLeaders = getStatLeaders(defendingData, 'interceptions');
        processedStats.headedDuelLeaders = getStatLeaders(defendingData, 'headedDuelsWon');
    }

    return processedStats;
};

// Helper function to process the NWSL standings API data
const processStandingsData = (apiData) => {
    try {
        if (!apiData?.standings?.[0]?.teams) { return null; }
        const gothamData = apiData.standings[0].teams.find(team => team.teamId === 'nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39');
        if (!gothamData || !gothamData.stats) { return null; }
        const getStat = (id) => gothamData.stats.find(s => s.statsId === id)?.statsValue;
        const rank = getStat('rank');
        const points = getStat('points');
        const wins = getStat('win');
        const losses = getStat('lose');
        const draws = getStat('draw');
        if ([rank, points, wins, losses, draws].some(s => s === undefined)) { return null; }
        return { rank, points, record: `${wins}-${losses}-${draws}` };
    } catch (error) { return null; }
};

// Helper to parse CSV data from your Google Sheet
const parseCsv = (csvString) => {
    return new Promise((resolve, reject) => {
        const results = {};
        const bufferStream = new stream.PassThrough();
        bufferStream.end(csvString);
        bufferStream
            .pipe(csv({ headers: ['lastName', 'headshotUrl', 'playerPageUrl'] }))
            .on('data', (data) => {
                if (data.lastName) {
                    results[normalizeName(data.lastName)] = data;
                }
            })
            .on('end', () => resolve(results))
            .on('error', (error) => reject(error));
    });
};

exports.handler = async function(event, context) {
    const CURRENT_SEASON_ID = "nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c";
    const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTpJmieTcb-C1k_4NDTLR_XfVUBzSc_GBrWVPAx4bt994junG5YY_S3EtZnS_0j42RwwYSYa4eGBpAq/pub?output=csv';
    const NWSL_ROSTER_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/roster?locale=en-US&seasonId=${CURRENT_SEASON_ID}`;
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${CURRENT_SEASON_ID}/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28`;
    const NWSL_STATS_BASE_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${CURRENT_SEASON_ID}/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=`;
    const NWSL_STANDINGS_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${CURRENT_SEASON_ID}/standings/overall?locale=en-US&orderBy=rank&direction=asc`;

    const fallbackData = { /* Your existing fallback data */ };
    
    async function fetchAndProcess(url, processor, fallback, ...args) {
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const processedData = processor(data, ...args);
            if (!processedData || (Array.isArray(processedData) && processedData.length === 0 && Object.keys(processedData).length === 0)) {
                throw new Error("Processing resulted in empty data.");
            }
            return processedData;
        } catch (error) {
            console.error(`Failed to fetch live data from ${url}, using fallback.`, error);
            return fallback;
        }
    }
    
    // UPDATED: Fetch all stat categories
    async function fetchAllStats() {
        const categories = ['general', 'standard', 'shooting', 'defending'];
        try {
            const statPromises = categories.map(category => 
                fetch(NWSL_STATS_BASE_URL + category).then(res => res.json()).then(data => ({category, data}))
            );
            const statsResponses = await Promise.all(statPromises);
            return processAllStatsData(statsResponses);
        } catch (error) {
            console.error('Failed to fetch some or all stats categories, using fallback.', error);
            return fallbackData.stats;
        }
    }

    async function fetchCsvData(url) {
        try {
            const response = await fetch(url);
            if (!response.ok) return {};
            const csvText = await response.text();
            return await parseCsv(csvText);
        } catch (error) { return {}; }
    }

    const enrichmentData = await fetchCsvData(GOOGLE_SHEET_CSV_URL);

    const [schedule, stats, standings] = await Promise.all([
        fetchAndProcess(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule),
        fetchAllStats(),
        fetchAndProcess(NWSL_STANDINGS_API_URL, processStandingsData, fallbackData.standings)
    ]);
    
    const roster = await fetchAndProcess(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster, enrichmentData);
    
    return {
        statusCode: 200,
        body: JSON.stringify({ roster, schedule, stats, standings })
    };
};

