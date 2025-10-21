// This is a serverless function that will run on Netlify's servers.
// Its job is to securely fetch data from an external API.

// Helper function to get the correct, standard position code.
const getPositionCode = (positionName) => {
    const name = positionName.toLowerCase();
    if (name.includes('forward')) return 'FW';
    if (name.includes('midfielder')) return 'MF';
    if (name.includes('defender')) return 'DF';
    if (name.includes('goalkeeper')) return 'GK';
    return 'UNK'; // Fallback for any unknown positions
};

// Roster processor for the official NWSL API data
const processNWSLRosterData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.squad) return [];
    
    return apiData.data.squad.map(player => {
        const jerseyStat = player.stats.find(stat => stat.name === 'number');
        return {
            name: player.participant.name,
            pos: getPositionCode(player.position.name), // This line has been updated
            num: jerseyStat ? jerseyStat.value : 'N/A',
            bio: `${player.position.name} from ${player.participant.country.name}`
        };
    });
};

// Schedule processor for the official NWSL API data
const processScheduleData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.matches) return [];
    const gothamMatches = apiData.data.matches.filter(match => 
        match.homeTeam.name === "NJ/NY Gotham FC" || match.awayTeam.name === "NJ/NY Gotham FC"
    );
    return gothamMatches.map(match => {
        const isHomeGame = match.homeTeam.name === "NJ/NY Gotham FC";
        const opponent = isHomeGame ? match.awayTeam.name : match.homeTeam.name;
        const broadcastInfo = match.broadcasts?.map(b => b.network.name).join(', ') || "TBD";
        return { opponent, date: match.matchDate, location: match.venue.name, broadcast: broadcastInfo, home: isHomeGame };
    });
};

// Stats processor for the official NWSL API data
const processStatsData = (apiData) => {
    if (!apiData || !apiData.data || !apiData.data.stats) return { goalLeader: null, assistLeader: null };
    
    const stats = apiData.data.stats;
    const goalStat = stats.find(s => s.name === 'goals');
    const assistStat = stats.find(s => s.name === 'total_assists');

    const goalLeader = goalStat?.leaders?.[0] ? { name: goalStat.leaders[0].participant.name, total: goalStat.leaders[0].value } : { name: "N/A", total: 0 };
    const assistLeader = assistStat?.leaders?.[0] ? { name: assistStat.leaders[0].participant.name, total: assistStat.leaders[0].value } : { name: "N/A", total: 0 };

    return { goalLeader, assistLeader };
};

exports.handler = async function(event, context) {
    const NWSL_ROSTER_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39/profile?locale=en-US';
    const NWSL_SCHEDULE_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/matches?locale=en-US&startDate=2025-01-22&endDate=2025-11-28';
    const NWSL_STATS_API_URL = 'https://api-sdp.nwslsoccer.com/v1/nwsl/football/seasons/nwsl::Football_Season::fad050beee834db88fa9f2eb28ce5a5c/stats/teams/nwsl::Football_Team::c83f2ca05aa84c738b5373f0d2a31b39?locale=en-US&category=attacking';

    const fallbackData = {
        roster: [ { name: "Ann-Katrin Berger", pos: "GK", num: 30, bio: "Veteran German international." }, { name: "Midge Purce", pos: "FW", num: 23, bio: "Explosive USWNT forward." } ],
        schedule: [ { opponent: "NC Courage", date: "2025-10-26T17:00:00Z", location: "WakeMed Soccer Park", broadcast: "NWSL+", home: false } ],
        stats: { goalLeader: { name: "Esther González", total: 9 }, assistLeader: { name: "Rose Lavelle", total: 6 } },
        news: [ { source: 'NWSLsoccer.com', date: 'Oct 21, 2025', title: 'Playoff Picture: What\'s at Stake on Decision Day', snippet: 'A complete breakdown of the scenarios facing Gotham FC...', url: 'https://www.nwslsoccer.com/' } ],
        social: [ { user: "Gotham FC", handle: "@GothamFC", time: "2h", type: "twitter", content: "One last push. Everything on the line this weekend. 🦇 #NWSL #GothamFC" } ]
    };

    async function fetchLiveRoster() {
        try {
            const response = await fetch(NWSL_ROSTER_API_URL);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const liveRoster = processNWSLRosterData(data);
            if (liveRoster.length === 0) throw new Error("Processing live roster resulted in an empty array.");
            return liveRoster;
        } catch (error) {
            console.error('Failed to fetch live roster, using fallback.', error);
            return fallbackData.roster;
        }
    }

    async function fetchLiveSchedule() {
        try {
            const response = await fetch(NWSL_SCHEDULE_API_URL);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            const liveSchedule = processScheduleData(data);
            if (liveSchedule.length === 0) throw new Error("Processing live schedule resulted in an empty array.");
            return liveSchedule;
        } catch (error) {
            console.error('Failed to fetch live schedule, using fallback.', error);
            return fallbackData.schedule;
        }
    }
    
    async function fetchLiveStats() {
        try {
            const response = await fetch(NWSL_STATS_API_URL);
            if (!response.ok) throw new Error(`API call failed: ${response.status}`);
            const data = await response.json();
            return processStatsData(data);
        } catch(error) {
            console.error('Failed to fetch live stats, using fallback.', error);
            return fallbackData.stats;
        }
    }

    const [roster, schedule, stats] = await Promise.all([
        fetchLiveRoster(),
        fetchLiveSchedule(),
        fetchLiveStats()
    ]);
    
    const responseData = { roster, schedule, stats, news: fallbackData.news, social: fallbackData.social };

    return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(responseData)
    };
};
