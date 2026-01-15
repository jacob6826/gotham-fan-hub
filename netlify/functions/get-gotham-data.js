// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from external APIs and fall back to stored data if needed.
const csv = require('csv-parser');
const stream = require('stream');

// Polyfill fetch for Node.js environments < 18
if (!global.fetch) {
    global.fetch = require('node-fetch');
    global.Headers = require('node-fetch').Headers;
    global.Request = require('node-fetch').Request;
    global.Response = require('node-fetch').Response;
}

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

// Helper to process the NWSL Schedule API data
const processScheduleData = (apiData) => {
    try {
        if (!apiData || !apiData.matches) return [];

        const GOTHAM_ID = "nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39";

        // Filter provided by API URL now, but keeping safe check just in case
        const gothamMatches = apiData.matches;

        return gothamMatches.map(m => {
            const dateObj = new Date(m.matchDate || m.date); // Handle potential field variations
            const dateStr = dateObj.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
            const timeStr = dateObj.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });

            // Robust checks for team objects
            const homeId = m.homeTeam ? m.homeTeam.teamId : '';
            const isHome = homeId === GOTHAM_ID;

            let opponent = "TBD";
            if (isHome && m.awayTeam) opponent = m.awayTeam.teamName || m.awayTeam.name || "TBD";
            else if (!isHome && m.homeTeam) opponent = m.homeTeam.teamName || m.homeTeam.name || "TBD";

            const location = m.venue ? m.venue.name : (m.venueName || (isHome ? 'Red Bull Arena' : 'Away'));
            const competition = m.competition ? (m.competition.name || m.competition.competitionName) : 'NWSL';

            return {
                date: dateStr,
                time: timeStr,
                competition: competition,
                opponent: opponent,
                location: location,
                home: isHome
            };
        });
    } catch (e) {
        console.error("Error processing schedule API:", e);
        return [];
    }
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

exports.handler = async function (event, context) {
    const SEASON_2025 = "nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c";
    const SEASON_2026 = "nwsl::Football_Season::0b6761e4701749f593690c0f338da74c";

    const GOOGLE_SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vTpJmieTcb-C1k_4NDTLR_XfVUBzSc_GBrWVPAx4bt994junG5YY_S3EtZnS_0j42RwwYSYa4eGBpAq/pub?output=csv';

    // Roster: Use 2026 as requested
    const NWSL_ROSTER_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/roster?locale=en-US&seasonId=${SEASON_2026}`;

    // Schedule, Stats, Standings: Use 2025 (since 2026 is empty)
    // UPDATE: User provided correct 2026 Schedule URL with team filter
    const NWSL_SCHEDULE_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${SEASON_2026}/matches?locale=en-US&relevantTeamIds=nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39`;
    const NWSL_STATS_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${SEASON_2025}/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=general`;
    const NWSL_STANDINGS_API_URL = `https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/${SEASON_2025}/standings/overall?locale=en-US&orderBy=rank&direction=asc`;

    const fallbackData = {
        roster: [{ name: "Ann-Katrin Berger", pos: "GK", num: 30, bio: "Goalkeeper from Germany", headshot: null, pageUrl: null }],
        schedule: [
            { opponent: "Example Opponent (Fallback)", date: "Date TBD", time: "Time TBD", location: "Location TBD", broadcast: "TBD", home: true }
        ],
        stats: { "goals-scored": { label: "Goals scored", value: 'N/A' } },
        standings: { rank: 'N/A', points: 'N/A', record: 'N/A' },
    };

    async function fetchAndProcess(url, processor, fallback, ...args) {
        try {
            const response = await fetch(url, { headers: { 'User-Agent': 'GothamFanHub/1.0' } });
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const processedData = processor(data, ...args);

            if (!processedData || (Array.isArray(processedData) && processedData.length === 0 && Object.keys(processedData).length === 0)) {
                // throw new Error("Processing resulted in empty data."); // Actually, empty array is valid if no games.
            }
            return processedData;
        } catch (error) {
            console.error(`Failed to fetch live data from ${url}, using fallback. Error:`, error);
            return fallback;
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

    // Run parallel fetches
    const [stats, standings, schedule] = await Promise.all([
        fetchAndProcess(NWSL_STATS_API_URL, processStatsData, fallbackData.stats),
        fetchAndProcess(NWSL_STANDINGS_API_URL, processStandingsData, fallbackData.standings),
        fetchAndProcess(NWSL_SCHEDULE_API_URL, processScheduleData, fallbackData.schedule)
    ]);

    const roster = await fetchAndProcess(NWSL_ROSTER_API_URL, processNWSLRosterData, fallbackData.roster, enrichmentData);

    // If scraping failed, use fallback
    const finalSchedule = (schedule && schedule.length > 0) ? schedule : fallbackData.schedule;

    return {
        statusCode: 200,
        body: JSON.stringify({ roster, schedule: finalSchedule, stats, standings })
    };
};
