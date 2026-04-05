"use strict";
const fs=require("fs");
const path=require("path");
const {ActionRowBuilder,ButtonBuilder,ButtonStyle,ChannelType,EmbedBuilder,StringSelectMenuBuilder}=require("discord.js");
const {getDB}=require("./database");
const {appendAdminAuditLog}=require("./auditLog");
const {askConfirmation,isAdmin}=require("./utils");

const IPL_SCHEDULE_PATH=path.join(__dirname,"iplmatches.md");
const IST_OFFSET_MINUTES=330;
const MATCH_CORRECT_POINTS=2;
const MATCH_WRONG_POINTS=-1;
const TOP4_THREE_HIT_POINTS=15;
const TOP4_FULL_HIT_POINTS=25;
const TOP4_DEADLINE_INPUT="30/03/2026 11:59 PM";
const MATCH_CANCELLED_OUTCOME="MATCH_CANCELLED";
const REMINDER_ROLE_NAME="IPL Prediction Alerts";
const REMINDER_REACTION_EMOJI="🔔";

const ADMIN_COMMANDS={SET_CHANNEL:"setiplpredictchannel",SET_ANNOUNCE_CHANNEL:"setiplannouncechannel",SET_ANNOUNCE_ROLES:"setiplannouncepingroles",ANNOUNCE:"announceipl",WINNER:"iplwinner",EDIT_WINNER:"editiplwinner",TOP4_RESULT:"ipltop4result",TOP4_PICKS:"ipltop4picks",FIXTURES:"iplfixtures",MATCH_REPORT:"iplmatchreport",DAY_PICKS:"ipldaypicks",STATS_PREVIEW:"predictionstatspreview",LB_PREVIEW:"predictlbpreview",FLOW_PREVIEW:"predictionflowpreview",GUIDE:"postpredictguide",REMINDER_PANEL:"predictiondmpanel"};
const USER_COMMANDS={PREDICT:"predict",LEADERBOARD:"predictlb",STATUS:"iplmatch",TOP4:"predicttop4",STATS:"predictionstats",MY_PREDICTIONS:"mypredictions"};

function normalizeTeamToken(input){return String(input||"").trim().toUpperCase().replace(/\s+/g," ");}
function calculateTop4Points(hitCount){
  if(hitCount===4)return TOP4_FULL_HIT_POINTS;
  if(hitCount===3)return TOP4_THREE_HIT_POINTS;
  return 0;
}
function countTop4Hits(entryTeams,resultTeams){
  let hits=0;
  for(const team of entryTeams.map(normalizeTeamToken))if(resultTeams.has(team))hits++;
  return hits;
}
function normalizeSettlementOutcome(input){
  const token=normalizeTeamToken(input);
  return ["MATCH CANCELLED","MATCH_CANCELLED","CANCELLED","CANCELED","CANCEL"].includes(token)?MATCH_CANCELLED_OUTCOME:token;
}
function isCancelledOutcome(input){return normalizeSettlementOutcome(input)===MATCH_CANCELLED_OUTCOME;}
function formatSettlementOutcome(input){return isCancelledOutcome(input)?"Match Cancelled":normalizeTeamToken(input);}
function formatIstAnnouncement(ts){
  const date=new Date(ts*1000);
  const datePart=new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Kolkata",day:"numeric",month:"short",year:"numeric"}).format(date);
  const timePart=new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",hour:"numeric",minute:"2-digit",hour12:true}).format(date).toUpperCase();
  return `${datePart} • ${timePart} IST`;
}
function getOrdinalLabel(slot){
  return slot===1?"first":slot===2?"second":slot===3?"third":`${slot}th`;
}
function parseExplicitIstDateTime(input){
  const m=String(input||"").trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!m)return null;
  let h=parseInt(m[4],10); const mer=m[6].toUpperCase();
  if(mer==="PM"&&h<12)h+=12; else if(mer==="AM"&&h===12)h=0;
  const utcMs=Date.UTC(parseInt(m[3],10),parseInt(m[2],10)-1,parseInt(m[1],10),h,parseInt(m[5],10),0)-(IST_OFFSET_MINUTES*60*1000);
  return Math.floor(utcMs/1000);
}
const TOP4_DEADLINE_AT=parseExplicitIstDateTime(TOP4_DEADLINE_INPUT);
function formatIst(ts){return `${new Intl.DateTimeFormat("en-IN",{timeZone:"Asia/Kolkata",dateStyle:"medium",timeStyle:"short"}).format(new Date(ts*1000))} IST`;}

function parseMarkdownTableRow(line){
  if(!line||!line.trim().startsWith("|"))return null;
  const p=line.split("|").slice(1,-1).map(v=>v.trim());
  if(p.length!==4)return null;
  if(p[0].toLowerCase()==="date"||/^-+$/.test(p[0].replace(/\s+/g,"")))return null;
  return {dateLabel:p[0],dayLabel:p[1],timeLabel:p[2],matchLabel:p[3]};
}
function parseMatchTeams(matchLabel){
  const m=String(matchLabel||"").trim().match(/^(.+?)\s+vs\s+(.+)$/i);
  return m?{teamA:normalizeTeamToken(m[1]),teamB:normalizeTeamToken(m[2])}:null;
}
function parseFixtureStartUnix(dateLabel,timeLabel){
  const d=String(dateLabel||"").trim().match(/^([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{4})$/);
  const t=String(timeLabel||"").trim().match(/^(\d{1,2}):(\d{2})\s*(AM|PM)$/i);
  if(!d||!t)return null;
  const months={JAN:1,FEB:2,MAR:3,APR:4,MAY:5,JUN:6,JUL:7,AUG:8,SEP:9,OCT:10,NOV:11,DEC:12};
  const month=months[d[1].toUpperCase()]; if(!month)return null;
  let h=parseInt(t[1],10); const mer=t[3].toUpperCase();
  if(mer==="PM"&&h<12)h+=12; else if(mer==="AM"&&h===12)h=0;
  const utcMs=Date.UTC(parseInt(d[3],10),month-1,parseInt(d[2],10),h,parseInt(t[2],10),0)-(IST_OFFSET_MINUTES*60*1000);
  return Math.floor(utcMs/1000);
}
function readIplFixtures(){
  let raw=""; try{raw=fs.readFileSync(IPL_SCHEDULE_PATH,"utf8");}catch(_e){return [];}
  const out=[];
  for(const line of raw.split(/\r?\n/)){
    const row=parseMarkdownTableRow(line); if(!row)continue;
    const teams=parseMatchTeams(row.matchLabel); const startsAt=parseFixtureStartUnix(row.dateLabel,row.timeLabel);
    if(!teams||!startsAt)continue;
    out.push({fixtureNumber:out.length+1,fixtureKey:`${row.dateLabel}|${row.timeLabel}|${teams.teamA}|${teams.teamB}`,dateLabel:row.dateLabel,dayLabel:row.dayLabel,timeLabel:row.timeLabel,matchLabel:`${teams.teamA} vs ${teams.teamB}`,teamA:teams.teamA,teamB:teams.teamB,startsAt,deadlineAt:startsAt});
  }
  return out;
}
function getValidTeamsFromFixtures(fixtures){const s=new Set(); for(const f of fixtures){s.add(f.teamA); s.add(f.teamB);} return s;}
function formatTop4List(teams){return teams.map((t,i)=>`**${i+1}.** ${t}`).join("\n");}
function parseTop4Teams(args){
  const teams=args.map(normalizeTeamToken).filter(Boolean);
  if(teams.length!==4)return {ok:false,message:"Usage: `?predicttop4 SRH RCB CSK MI`"};
  if(new Set(teams).size!==4)return {ok:false,message:"Top 4 prediction must contain 4 different teams."};
  return {ok:true,teams};
}
function resolveFixtureSelection(fixtures,args){
  const selector=String((args[0]||"next")).trim().toLowerCase(), now=Math.floor(Date.now()/1000);
  if(selector==="next")return fixtures.find(f=>f.startsAt>now)||null;
  const n=parseInt(selector,10); return !Number.isNaN(n)&&n>=1&&n<=fixtures.length?fixtures[n-1]:null;
}
async function getPredictionSettings(guildId){return getDB().get("SELECT * FROM ipl_prediction_settings WHERE guild_id = ?",guildId);}
async function savePredictionSettings(guildId,patch){
  const db=getDB();
  const current=await getPredictionSettings(guildId)||{};
  const next={
    channel_id:Object.prototype.hasOwnProperty.call(patch,"channel_id")?patch.channel_id:(current.channel_id||null),
    announcement_channel_id:Object.prototype.hasOwnProperty.call(patch,"announcement_channel_id")?patch.announcement_channel_id:(current.announcement_channel_id||null),
    announcement_role_ids_json:Object.prototype.hasOwnProperty.call(patch,"announcement_role_ids_json")?patch.announcement_role_ids_json:(current.announcement_role_ids_json||null),
    reminder_role_id:Object.prototype.hasOwnProperty.call(patch,"reminder_role_id")?patch.reminder_role_id:(current.reminder_role_id||null),
    reminder_panel_channel_id:Object.prototype.hasOwnProperty.call(patch,"reminder_panel_channel_id")?patch.reminder_panel_channel_id:(current.reminder_panel_channel_id||null),
    reminder_panel_message_id:Object.prototype.hasOwnProperty.call(patch,"reminder_panel_message_id")?patch.reminder_panel_message_id:(current.reminder_panel_message_id||null)
  };
  await db.run(`INSERT INTO ipl_prediction_settings (guild_id, channel_id, announcement_channel_id, announcement_role_ids_json, reminder_role_id, reminder_panel_channel_id, reminder_panel_message_id)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(guild_id) DO UPDATE SET
      channel_id = excluded.channel_id,
      announcement_channel_id = excluded.announcement_channel_id,
      announcement_role_ids_json = excluded.announcement_role_ids_json,
      reminder_role_id = excluded.reminder_role_id,
      reminder_panel_channel_id = excluded.reminder_panel_channel_id,
      reminder_panel_message_id = excluded.reminder_panel_message_id`,
    guildId,next.channel_id,next.announcement_channel_id,next.announcement_role_ids_json,next.reminder_role_id,next.reminder_panel_channel_id,next.reminder_panel_message_id);
  return getPredictionSettings(guildId);
}
function parseAnnouncementRoleIds(raw){
  if(!raw)return [];
  try{
    const parsed=JSON.parse(raw);
    return Array.isArray(parsed)?parsed.map(id=>String(id)).filter(Boolean):[];
  }catch(_e){
    return [];
  }
}
function buildAnnouncementRoleMentions(roleIds){
  return roleIds.map(id=>`<@&${id}>`).join(" ");
}
async function getActivePredictionMatches(guildId){const now=Math.floor(Date.now()/1000); return getDB().all(`SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND status != 'SETTLED' AND deadline_at > ? ORDER BY starts_at ASC, id ASC`,guildId,now);}
async function getActivePredictionMatch(guildId){const now=Math.floor(Date.now()/1000); return getDB().get(`SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND status != 'SETTLED' AND deadline_at > ? ORDER BY starts_at ASC, id ASC LIMIT 1`,guildId,now);}
async function getActivePredictionBatch(guildId){
  const matches=await getActivePredictionMatches(guildId);
  if(!matches.length)return [];
  const firstDate=matches[0].match_date_label;
  return matches.filter(m=>m.match_date_label===firstDate).sort((a,b)=>a.starts_at-b.starts_at||a.id-b.id);
}
async function getPendingSettlementMatches(guildId){
  const now=Math.floor(Date.now()/1000);
  return getDB().all(`SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND status != 'SETTLED' AND deadline_at <= ? ORDER BY starts_at ASC, id ASC`,guildId,now);
}
async function getPendingSettlementBatch(guildId){
  const matches=await getPendingSettlementMatches(guildId);
  if(!matches.length)return [];
  const firstDate=matches[0].match_date_label;
  return matches.filter(m=>m.match_date_label===firstDate).sort((a,b)=>a.starts_at-b.starts_at||a.id-b.id);
}
async function getSettledPredictionMatches(guildId){
  return getDB().all(`SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND status = 'SETTLED' ORDER BY starts_at DESC, id DESC`,guildId);
}
async function getTop4Result(guildId){return getDB().get("SELECT * FROM ipl_top4_results WHERE guild_id = ?",guildId);}
async function getTop4Entry(guildId,userId){return getDB().get("SELECT * FROM ipl_top4_entries WHERE guild_id = ? AND user_id = ?",guildId,userId);}
async function ensureReminderRole(guild,settings){
  let role=settings?.reminder_role_id?guild.roles.cache.get(settings.reminder_role_id):null;
  if(!role)role=guild.roles.cache.find(r=>r.name===REMINDER_ROLE_NAME)||null;
  if(role)return role;
  return guild.roles.create({
    name:REMINDER_ROLE_NAME,
    colors:{primaryColor:0x2563eb},
    permissions:[],
    mentionable:false,
    hoist:false,
    reason:"IPL prediction DM reminders"
  });
}
function buildReminderPanelEmbed(roleId,predictionChannelId){
  return new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle("IPL Prediction DM Alerts")
    .setDescription(`React with ${REMINDER_REACTION_EMOJI} on this message to get the <@&${roleId}> role and receive a DM whenever a new IPL prediction batch is announced.`)
    .addFields(
      {name:"What You Get",value:"When an admin opens the next IPL prediction batch, the bot will DM you with the match names, prediction commands, and where to predict.",inline:false},
      {name:"Who Gets DMed",value:"Only users with the reminder role who have not predicted the active announced batch yet.",inline:false},
      {name:"Where To Predict",value:predictionChannelId?`Use <#${predictionChannelId}> for your IPL prediction commands.`:"Prediction channel not configured yet.",inline:false}
    )
    .setFooter({text:"Remove your reaction to remove the role and stop reminders."});
}
function buildBatchReminderEmbed(batchMatches,predictionChannelId){
  return new EmbedBuilder()
    .setColor(0x16a34a)
    .setTitle("New IPL Prediction Batch Open")
    .setDescription(batchMatches.map((match,index)=>`**${batchMatches.length>1?`Match ${index+1}: `:""}${match.match_label}**\nDeadline: ${formatIst(match.deadline_at)}\nCommand: \`${batchMatches.length>1?`?predict${index+1}`:"?predict"}\``).join("\n\n"))
    .addFields({name:"Prediction Channel",value:predictionChannelId?`<#${predictionChannelId}>`:"Channel not configured",inline:true},{name:"Reminder",value:"You received this because you opted into IPL prediction DM alerts.",inline:false})
    .setFooter({text:"Submit your pick before the deadline."});
}
async function sendBatchReminderDms(guild,settings,batchMatches){
  const roleId=settings?.reminder_role_id;
  if(!roleId||!batchMatches.length)return {sent:0,failed:0,skipped:0};
  const role=guild.roles.cache.get(roleId)||await guild.roles.fetch(roleId).catch(()=>null);
  if(!role)return {sent:0,failed:0,skipped:0};
  const db=getDB(), matchIds=batchMatches.map(m=>m.id), placeholders=matchIds.map(()=>"?").join(",");
  let sent=0, failed=0, skipped=0;
  const members=[...role.members.values()].filter(member=>!member.user.bot);
  for(const member of members){
    const row=await db.get(`SELECT COUNT(*) AS count FROM ipl_prediction_entries WHERE user_id = ? AND match_id IN (${placeholders})`,member.id,...matchIds);
    const predictedCount=Number(row?.count||0);
    if(predictedCount>=matchIds.length){skipped++; continue;}
    try{
      await member.send({embeds:[buildBatchReminderEmbed(batchMatches,settings.channel_id||null)]});
      sent++;
    }catch(_e){
      failed++;
    }
  }
  return {sent,failed,skipped};
}
function buildPredictionButtons(match){return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ipl_predict:${match.id}:${match.team_a}`).setLabel(match.team_a).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`ipl_predict:${match.id}:${match.team_b}`).setLabel(match.team_b).setStyle(ButtonStyle.Danger))];}
function buildSettlementButtons(match){return [new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`ipl_settle:${match.id}:${match.team_a}`).setLabel(match.team_a).setStyle(ButtonStyle.Primary),new ButtonBuilder().setCustomId(`ipl_settle:${match.id}:${match.team_b}`).setLabel(match.team_b).setStyle(ButtonStyle.Danger),new ButtonBuilder().setCustomId(`ipl_settle:${match.id}:${MATCH_CANCELLED_OUTCOME}`).setLabel("Match Cancelled").setStyle(ButtonStyle.Secondary))];}
function formatSettlementPickerLine(match,mode){
  const statusLine=mode==="edit"?`Current Result: **${formatSettlementOutcome(match.winner_team)}**`:`Deadline Passed: **${formatIst(match.deadline_at)}**`;
  return `**#${match.fixture_number}** ${match.match_label}\n${statusLine}`;
}
function buildSettlementManagerEmbed(mode,matches,page,selectedMatch,outcome){
  const totalPages=Math.max(Math.ceil(matches.length/25),1);
  const pageMatches=matches.slice(page*25,(page+1)*25);
  const title=mode==="edit"?"Edit IPL Result":"Settle IPL Match";
  const description=mode==="edit"
    ?"Select a settled match, choose the corrected result, then confirm the edit."
    :"Select an overdue unsettled match, choose the result, then confirm settlement.";
  const embed=new EmbedBuilder()
    .setColor(mode==="edit"?0xdc2626:0xf59e0b)
    .setTitle(title)
    .setDescription(description)
    .addFields(
      {name:mode==="edit"?"Settled Matches":"Matches Ready",value:String(matches.length),inline:true},
      {name:"Page",value:`${page+1}/${totalPages}`,inline:true},
      {name:"Selected Outcome",value:outcome?formatSettlementOutcome(outcome):"Not selected",inline:true},
      {name:"Available Matches",value:pageMatches.length?pageMatches.map(match=>formatSettlementPickerLine(match,mode)).join("\n\n").slice(0,1024):"No matches available.",inline:false}
    );
  if(selectedMatch){
    embed.addFields({
      name:"Selected Match",
      value:`**#${selectedMatch.fixture_number} ${selectedMatch.match_label}**\nDeadline: ${formatIst(selectedMatch.deadline_at)}${mode==="edit"?`\nCurrent Result: **${formatSettlementOutcome(selectedMatch.winner_team)}**`:""}`,
      inline:false
    });
  }
  embed.setFooter({text:"Only the command invoker can use this panel. It expires in 5 minutes."});
  return embed;
}
function buildSettlementMatchSelect(mode,matches,page,selectedMatchId){
  const options=matches.slice(page*25,(page+1)*25).map(match=>({
    label:`#${match.fixture_number} ${match.match_label}`.slice(0,100),
    value:String(match.id),
    description:(mode==="edit"?`Current: ${formatSettlementOutcome(match.winner_team)}`:`Deadline passed: ${formatIst(match.deadline_at)}`).slice(0,100),
    default:String(match.id)===String(selectedMatchId||"")
  }));
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ipl_settlement_match_select")
      .setPlaceholder(mode==="edit"?"Select a settled match to edit":"Select a passed-deadline match to settle")
      .addOptions(options)
  );
}
function buildSettlementOutcomeRow(selectedMatch){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ipl_settlement_outcome_team_a").setLabel(selectedMatch?.team_a||"Team A").setStyle(ButtonStyle.Primary).setDisabled(!selectedMatch),
    new ButtonBuilder().setCustomId("ipl_settlement_outcome_team_b").setLabel(selectedMatch?.team_b||"Team B").setStyle(ButtonStyle.Danger).setDisabled(!selectedMatch),
    new ButtonBuilder().setCustomId("ipl_settlement_outcome_cancelled").setLabel("Match Cancelled").setStyle(ButtonStyle.Secondary).setDisabled(!selectedMatch)
  );
}
function buildSettlementControlRow(matches,page,selectedMatch,outcome,mode){
  const totalPages=Math.max(Math.ceil(matches.length/25),1);
  const currentOutcome=selectedMatch?normalizeSettlementOutcome(selectedMatch.winner_team):null;
  const confirmDisabled=!selectedMatch||!outcome||(mode==="edit"&&currentOutcome===outcome);
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ipl_settlement_prev_page").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    new ButtonBuilder().setCustomId("ipl_settlement_next_page").setLabel("Next").setStyle(ButtonStyle.Secondary).setDisabled(page>=totalPages-1),
    new ButtonBuilder().setCustomId("ipl_settlement_confirm").setLabel(mode==="edit"?"Confirm Edit":"Confirm Result").setStyle(ButtonStyle.Success).setDisabled(confirmDisabled),
    new ButtonBuilder().setCustomId("ipl_settlement_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  );
}
function buildSettlementManagerComponents(mode,matches,page,selectedMatch,outcome){
  const rows=[];
  if(matches.length)rows.push(buildSettlementMatchSelect(mode,matches,page,selectedMatch?.id||null));
  rows.push(buildSettlementOutcomeRow(selectedMatch));
  rows.push(buildSettlementControlRow(matches,page,selectedMatch,outcome,mode));
  return rows;
}
function buildAnnouncementEmbed(match,slot,batchSize,predictionChannelId){
  const commandLabel=batchSize>1?`?predict${slot}`:"?predict";
  return new EmbedBuilder()
    .setColor(0x1d4ed8)
    .setTitle(`IPL Prediction Open: ${match.match_label}`)
    .setDescription(`Fixture #${match.fixture_number}${batchSize>1?` | Match Slot #${slot}`:""}`)
    .addFields(
      {name:"Match Time",value:formatIst(match.starts_at),inline:true},
      {name:"Prediction Deadline",value:formatIst(match.deadline_at),inline:true},
      {name:"Points",value:`Correct: **+${MATCH_CORRECT_POINTS}** | Wrong: **${MATCH_WRONG_POINTS}**`,inline:true},
      {name:"Prediction Channel",value:`<#${predictionChannelId}>`,inline:true},
      {name:"Prediction Command",value:`\`${commandLabel}\``,inline:true},
      {name:"How To Predict",value:`Go to <#${predictionChannelId}>, run \`${commandLabel}\`, then click your winner.`,inline:false}
    )
    .setFooter({text:"Predictions close exactly at match start time."});
}
function buildAnnouncementText(match,slot,batchSize,predictionChannelId,rolePingIds=[]){
  const commandLabel=batchSize>1?`?predict${slot}`:"?predict";
  const predictionChannelLine=predictionChannelId?`<#${predictionChannelId}>`:"Prediction channel not configured";
  const intro=batchSize>1?`It’s time for the ${getOrdinalLabel(slot)} match prediction of the day — **${match.match_label}** is now live.`:`It’s time for a new IPL prediction — **${match.match_label}** is now live.`;
  const rolePingLine=rolePingIds.length?`\n${buildAnnouncementRoleMentions(rolePingIds)}`:"";
  return `🏏 **IPL Prediction Open — Fixture #${match.fixture_number}: ${match.match_label}**\n\n${intro}\n\n━━━━━━━━━━━━━━━━━━\n**📅 Deadline**  \n**${formatIstAnnouncement(match.deadline_at)}**\n\n**🎯 Scoring**  \n• **+${MATCH_CORRECT_POINTS}** for a correct prediction  \n• **${MATCH_WRONG_POINTS}** for an incorrect prediction\n\n**📍 Predict Here**  \n${predictionChannelLine}\n\n**💬 Use Command**  \n\`${commandLabel}\`\n\n**✅ Enter Now**  \nGo to ${predictionChannelLine}, type \`${commandLabel}\`, and lock in your winner before the deadline.\n━━━━━━━━━━━━━━━━━━\n\nLock in your pick and good luck!${rolePingLine}`;
}
function buildPredictionPromptEmbed(match){return new EmbedBuilder().setColor(0x16a34a).setTitle(`Predict: ${match.match_label}`).setDescription("Choose the team you think will win this match.").addFields({name:"Prediction Deadline",value:formatIst(match.deadline_at),inline:true},{name:"Current Match",value:`Fixture #${match.fixture_number}`,inline:true},{name:"Scoring",value:`Correct: **+${MATCH_CORRECT_POINTS}** | Wrong: **${MATCH_WRONG_POINTS}**`,inline:true}).setFooter({text:"You can change your pick any time before the deadline."});}
function buildPredictionSavedEmbed(match,predictedTeam){return new EmbedBuilder().setColor(0x0f766e).setTitle(`Saved Prediction: ${match.match_label}`).setDescription(`You chose **${predictedTeam}** for **${match.match_label}**.`).addFields({name:"Prediction Deadline",value:formatIst(match.deadline_at),inline:true},{name:"Current Match",value:`Fixture #${match.fixture_number}`,inline:true},{name:"Scoring",value:`Correct: **+${MATCH_CORRECT_POINTS}** | Wrong: **${MATCH_WRONG_POINTS}**`,inline:true}).setFooter({text:"You can still change your pick before the deadline by clicking again."});}
function buildSettlementPromptEmbed(match){return new EmbedBuilder().setColor(0xf59e0b).setTitle(`Settle IPL Match: ${match.match_label}`).setDescription("Choose the winner or mark the fixture as cancelled.").addFields({name:"Prediction Deadline",value:formatIst(match.deadline_at),inline:true},{name:"Fixture",value:`#${match.fixture_number}`,inline:true},{name:"Cancelled Result",value:"All predictions get **0 points**",inline:true});}
function buildSettlementSuccessEmbed(match,outcome,mode,previousOutcome){
  const embed=new EmbedBuilder()
    .setColor(mode==="edit"?0x16a34a:0x0f766e)
    .setTitle(mode==="edit"?"IPL Result Updated":"IPL Match Settled")
    .setDescription(`**${match.match_label}** is now set to **${formatSettlementOutcome(outcome)}**.`)
    .addFields({name:"Fixture",value:`#${match.fixture_number}`,inline:true},{name:"Deadline",value:formatIst(match.deadline_at),inline:true});
  if(mode==="edit"&&previousOutcome)embed.addFields({name:"Previous Result",value:formatSettlementOutcome(previousOutcome),inline:true});
  return embed;
}
function buildGuideEmbeds(predictionChannelId){
  const channelLine=predictionChannelId?`Use all user prediction commands in <#${predictionChannelId}>.`:"Use the configured IPL prediction channel for user prediction commands.";
  const userEmbed=new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle("How IPL Predictions Work")
    .setDescription(`Predict match winners and the final Top 4 during the season.\n\n${channelLine}`)
    .addFields(
      {name:"How To Predict A Match",value:"1. Wait for an admin to announce the active match.\n2. Run `?predict` for a single-match day, or `?predict1` / `?predict2` for a doubleheader day.\n3. Click your team button.\n4. You can change your pick before the deadline.",inline:false},
      {name:"How To Predict Top 4",value:`Run \`?predicttop4 SRH RCB CSK MI\` before **${formatIst(TOP4_DEADLINE_AT)}**.\nOrder does not matter for scoring.`,inline:false},
      {name:"Scoring",value:`Match correct: **+${MATCH_CORRECT_POINTS}**\nMatch wrong: **${MATCH_WRONG_POINTS}**\nMatch cancelled: **0**\nTop 4: **3/4 matched = ${TOP4_THREE_HIT_POINTS}**, **4/4 matched = ${TOP4_FULL_HIT_POINTS}**, **0-2 = 0**`,inline:false},
      {name:"Useful Commands",value:"`?predict`, `?predict1`, `?predict2`, `?predicttop4`, `?mypredictions`, `?predictionstats`, `?predictlb`, `?iplmatch`",inline:false}
    )
    .setFooter({text:"Prediction buttons stop working after the deadline."});
  const adminEmbed=new EmbedBuilder()
    .setColor(0xf59e0b)
    .setTitle("Admin Flow")
    .setDescription("Admin reference for running and settling the IPL prediction system.")
    .addFields(
      {name:"Setup",value:"`?setiplpredictchannel`\nSets the dedicated prediction channel.",inline:false},
      {name:"Start Match Predictions",value:"`?announceipl next`\nOr `?announceipl <fixture number>` to announce a specific fixture batch.",inline:false},
      {name:"Settle Results",value:"`?iplwinner`, `?iplwinner1`, `?iplwinner2`\nChoose Team A, Team B, or `Match Cancelled` after the deadline.",inline:false},
      {name:"Settle Top 4",value:"`?ipltop4result SRH RCB CSK MI`",inline:false},
      {name:"Inspection",value:"`?iplfixtures`, `?iplmatchreport <fixture number>`, `?ipldaypicks [fixture number]`, `?ipltop4picks`, `?helppredict`",inline:false}
    );
  return [userEmbed,adminEmbed];
}
function buildResultEmbed(match,correctCount,wrongCount,totalCount){
  if(isCancelledOutcome(match.winner_team))return new EmbedBuilder().setColor(0x6b7280).setTitle(`IPL Result Updated: ${match.match_label}`).setDescription("Result: **Match Cancelled**").addFields({name:"Predictions Closed",value:formatIst(match.deadline_at),inline:true},{name:"Points",value:"All predictions: **0**",inline:true},{name:"Entries",value:String(totalCount),inline:true});
  return new EmbedBuilder().setColor(0xf59e0b).setTitle(`IPL Result Updated: ${match.match_label}`).setDescription(`Winner: **${formatSettlementOutcome(match.winner_team)}**`).addFields({name:"Predictions Closed",value:formatIst(match.deadline_at),inline:true},{name:"Correct / Wrong",value:`${correctCount} / ${wrongCount}`,inline:true},{name:"Entries",value:String(totalCount),inline:true});
}
function buildTop4ResultEmbed(teams){return new EmbedBuilder().setColor(0xea580c).setTitle("IPL Top 4 Finalized").setDescription(formatTop4List(teams)).addFields({name:"Scoring",value:`**3/4 matched = ${TOP4_THREE_HIT_POINTS} points** | **4/4 matched = ${TOP4_FULL_HIT_POINTS} points** | **0-2 matched = 0**`});}
async function getPreviewMembers(guild,limit=8){
  try{await guild.members.fetch({limit:Math.max(limit,20)}).catch(()=>null);}catch(_e){}
  const members=[...guild.members.cache.values()].filter(m=>!m.user.bot).slice(0,limit);
  return members.length?members:[];
}
async function getCombinedLeaderboardRows(guildId,limit=10){
  const db=getDB();
  const matchRows=await db.all(`
    SELECT e.user_id, COUNT(*) AS total_predictions,
           SUM(CASE WHEN UPPER(COALESCE(m.winner_team,''))=? THEN 0 WHEN UPPER(e.predicted_team)=UPPER(m.winner_team) THEN 1 ELSE 0 END) AS correct_predictions,
           SUM(CASE WHEN UPPER(COALESCE(m.winner_team,''))=? THEN 0 WHEN UPPER(e.predicted_team)=UPPER(m.winner_team) THEN 0 ELSE 1 END) AS wrong_predictions,
           SUM(CASE WHEN UPPER(COALESCE(m.winner_team,''))=? THEN 0 WHEN UPPER(e.predicted_team)=UPPER(m.winner_team) THEN ? ELSE ? END) AS match_points
    FROM ipl_prediction_entries e
    JOIN ipl_prediction_matches m ON m.id = e.match_id
    WHERE m.guild_id = ? AND m.status = 'SETTLED' AND m.winner_team IS NOT NULL
    GROUP BY e.user_id
  `,MATCH_CANCELLED_OUTCOME,MATCH_CANCELLED_OUTCOME,MATCH_CANCELLED_OUTCOME,MATCH_CORRECT_POINTS,MATCH_WRONG_POINTS,guildId);
  const top4Result=await getTop4Result(guildId);
  const top4Rows=top4Result?await db.all(`SELECT user_id, slot_1_team, slot_2_team, slot_3_team, slot_4_team FROM ipl_top4_entries WHERE guild_id = ?`,guildId):[];
  const byUser=new Map();
  for(const row of matchRows)byUser.set(row.user_id,{userId:row.user_id,totalPredictions:Number(row.total_predictions||0),correctPredictions:Number(row.correct_predictions||0),wrongPredictions:Number(row.wrong_predictions||0),matchPoints:Number(row.match_points||0),top4Points:0});
  if(top4Result){
    const resultTeams=new Set([top4Result.slot_1_team,top4Result.slot_2_team,top4Result.slot_3_team,top4Result.slot_4_team].map(normalizeTeamToken));
    for(const row of top4Rows){
      const ex=byUser.get(row.user_id)||{userId:row.user_id,totalPredictions:0,correctPredictions:0,wrongPredictions:0,matchPoints:0,top4Points:0};
      const hits=countTop4Hits([row.slot_1_team,row.slot_2_team,row.slot_3_team,row.slot_4_team],resultTeams);
      ex.top4Points=calculateTop4Points(hits);
      byUser.set(row.user_id,ex);
    }
  }
  const ranked=[...byUser.values()].map(r=>({...r,totalPoints:r.matchPoints+r.top4Points})).sort((a,b)=>b.totalPoints-a.totalPoints||b.matchPoints-a.matchPoints||b.correctPredictions-a.correctPredictions||a.wrongPredictions-b.wrongPredictions||a.userId.localeCompare(b.userId));
  return Number.isInteger(limit)?ranked.slice(0,limit):ranked;
}
async function buildLeaderboardPayload(guild,limit=10){
  const db=getDB(), rows=await getCombinedLeaderboardRows(guild.id,limit);
  const settledCountRow=await db.get("SELECT COUNT(*) AS count FROM ipl_prediction_matches WHERE guild_id = ? AND status = 'SETTLED'",guild.id);
  const top4Result=await getTop4Result(guild.id);
  const settledMatches=Number(settledCountRow?.count||0);
  const embed=new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("IPL Prediction Leaderboard")
    .setDescription(`Settled matches: **${settledMatches}** | Top 4 settled: **${top4Result?"Yes":"No"}**`)
    .addFields(
      {name:"Scoring",value:`Correct: **+${MATCH_CORRECT_POINTS}** | Wrong: **${MATCH_WRONG_POINTS}** | Cancelled: **0** | Top 4: **3/4 = ${TOP4_THREE_HIT_POINTS}**, **4/4 = ${TOP4_FULL_HIT_POINTS}**, **0-2 = 0**`,inline:false},
      {name:"Standings",value:rows.length?rows.map((r,i)=>`${i===0?"🥇":i===1?"🥈":i===2?"🥉":`**${i+1}.**`} <@${r.userId}> | **${r.totalPoints} Overall Points**\nMatch Points: ${r.matchPoints} | Top 4 Points: ${r.top4Points} | W/L: ${r.correctPredictions}/${r.wrongPredictions}`).join("\n\n"):"No scored predictions yet.",inline:false}
    )
    .setFooter({text:"Embed leaderboard view"});
  return {embeds:[embed]};
}
async function handleLeaderboardCommand(message){
  const db=getDB(), guild=message.guild;
  const rows=await getCombinedLeaderboardRows(guild.id,null);
  const settledCountRow=await db.get("SELECT COUNT(*) AS count FROM ipl_prediction_matches WHERE guild_id = ? AND status = 'SETTLED'",guild.id);
  const top4Result=await getTop4Result(guild.id);
  const settledMatches=Number(settledCountRow?.count||0);
  const pages=chunkArray(rows,8);
  const buildEmbed=(pageIndex)=>{
    const pageRows=pages[pageIndex]||[];
    return new EmbedBuilder()
      .setColor(0x7c3aed)
      .setTitle(`IPL Prediction Leaderboard${pages.length>1?` (${pageIndex+1}/${pages.length})`:""}`)
      .setDescription(`Settled matches: **${settledMatches}** | Top 4 settled: **${top4Result?"Yes":"No"}**`)
      .addFields(
        {name:"Scoring",value:`Correct: **+${MATCH_CORRECT_POINTS}** | Wrong: **${MATCH_WRONG_POINTS}** | Cancelled: **0** | Top 4: **3/4 = ${TOP4_THREE_HIT_POINTS}**, **4/4 = ${TOP4_FULL_HIT_POINTS}**, **0-2 = 0**`,inline:false},
        {name:"Standings",value:pageRows.length?pageRows.map((r,i)=>{const rank=(pageIndex*8)+i+1; return `${rank===1?"🥇":rank===2?"🥈":rank===3?"🥉":`**${rank}.**`} <@${r.userId}> | **${r.totalPoints} Overall Points**\nMatch Points: ${r.matchPoints} | Top 4 Points: ${r.top4Points} | W/L: ${r.correctPredictions}/${r.wrongPredictions}`;}).join("\n\n"):"No scored predictions yet.",inline:false}
      )
      .setFooter({text:pages.length>1?"Use Previous / Next to browse leaderboard pages.":"Embed leaderboard view"});
  };
  if(pages.length<=1){
    await message.reply({embeds:[buildEmbed(0)]});
    return;
  }
  let page=0;
  const buildRow=(pageIndex)=>new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ipl_lb_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(pageIndex===0),
    new ButtonBuilder().setCustomId("ipl_lb_next").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(pageIndex===pages.length-1)
  );
  const response=await message.reply({embeds:[buildEmbed(page)],components:[buildRow(page)]});
  const collector=response.createMessageComponentCollector({
    filter:i=>i.user.id===message.author.id&&(i.customId==="ipl_lb_prev"||i.customId==="ipl_lb_next"),
    time:300000
  });
  collector.on("collect",async i=>{
    if(i.customId==="ipl_lb_prev"&&page>0)page--;
    if(i.customId==="ipl_lb_next"&&page<pages.length-1)page++;
    await i.update({embeds:[buildEmbed(page)],components:[buildRow(page)]}).catch(()=>null);
  });
  collector.on("end",()=>{response.edit({components:[]}).catch(()=>null);});
}
async function buildPredictionStatsEmbed(guildId,userId){
  const db=getDB();
  const leaderboardRows=await getCombinedLeaderboardRows(guildId,null);
  const userRank=leaderboardRows.findIndex(row=>row.userId===userId)+1;
  const matchStats=await db.get(`
    SELECT COUNT(*) AS total_predictions,
           SUM(CASE WHEN UPPER(COALESCE(m.winner_team,''))=? THEN 0 WHEN UPPER(e.predicted_team)=UPPER(m.winner_team) THEN 1 ELSE 0 END) AS correct_predictions,
           SUM(CASE WHEN UPPER(COALESCE(m.winner_team,''))=? THEN 0 WHEN UPPER(e.predicted_team)=UPPER(m.winner_team) THEN 0 ELSE 1 END) AS wrong_predictions,
           SUM(CASE WHEN UPPER(COALESCE(m.winner_team,''))=? THEN 0 WHEN UPPER(e.predicted_team)=UPPER(m.winner_team) THEN ? ELSE ? END) AS match_points
    FROM ipl_prediction_entries e
    JOIN ipl_prediction_matches m ON m.id = e.match_id
    WHERE m.guild_id = ? AND e.user_id = ? AND m.status = 'SETTLED' AND m.winner_team IS NOT NULL
  `,MATCH_CANCELLED_OUTCOME,MATCH_CANCELLED_OUTCOME,MATCH_CANCELLED_OUTCOME,MATCH_CORRECT_POINTS,MATCH_WRONG_POINTS,guildId,userId);
  const top4Entry=await getTop4Entry(guildId,userId), top4Result=await getTop4Result(guildId);
  let top4Points=0, top4Hits=0;
  if(top4Entry&&top4Result){
    const entryTeams=[top4Entry.slot_1_team,top4Entry.slot_2_team,top4Entry.slot_3_team,top4Entry.slot_4_team].map(normalizeTeamToken);
    const resultTeams=new Set([top4Result.slot_1_team,top4Result.slot_2_team,top4Result.slot_3_team,top4Result.slot_4_team].map(normalizeTeamToken));
    top4Hits=countTop4Hits(entryTeams,resultTeams);
    top4Points=calculateTop4Points(top4Hits);
  }
  const totalPredictions=Number(matchStats?.total_predictions||0), correctPredictions=Number(matchStats?.correct_predictions||0), wrongPredictions=Number(matchStats?.wrong_predictions||0), matchPoints=Number(matchStats?.match_points||0), totalPoints=matchPoints+top4Points;
  const embed=new EmbedBuilder().setColor(0x0891b2).setTitle("Your IPL Prediction Stats").setDescription("Overall Points = Match Points + Top 4 Points.").addFields({name:"Leaderboard Rank",value:userRank?`#${userRank}`:"Unranked",inline:true},{name:"Overall Points",value:String(totalPoints),inline:true},{name:"Match Points",value:String(matchPoints),inline:true},{name:"Top 4 Points",value:String(top4Points),inline:true},{name:"Correct / Wrong",value:`${correctPredictions} / ${wrongPredictions}`,inline:true},{name:"Settled Match Picks",value:String(totalPredictions),inline:true},{name:"Top 4 Hits",value:`${top4Hits}/4`,inline:true});
  embed.addFields({name:`Your Top 4 Pick${top4Result?"":" (Pending)"}`,value:top4Entry?formatTop4List([top4Entry.slot_1_team,top4Entry.slot_2_team,top4Entry.slot_3_team,top4Entry.slot_4_team]):`No Top 4 prediction submitted yet.\nDeadline: **${formatIst(TOP4_DEADLINE_AT)}**`});
  if(top4Result)embed.addFields({name:"Final Top 4",value:formatTop4List([top4Result.slot_1_team,top4Result.slot_2_team,top4Result.slot_3_team,top4Result.slot_4_team])});
  return embed;
}
function buildTop4Summary(entry,result){
  if(!entry)return `No Top 4 prediction submitted yet.\nDeadline: **${formatIst(TOP4_DEADLINE_AT)}**`;
  const entryTeams=[entry.slot_1_team,entry.slot_2_team,entry.slot_3_team,entry.slot_4_team];
  if(!result)return `${formatTop4List(entryTeams)}\nStatus: **Pending**`;
  const resultTeams=new Set([result.slot_1_team,result.slot_2_team,result.slot_3_team,result.slot_4_team].map(normalizeTeamToken));
  const hits=countTop4Hits(entryTeams,resultTeams);
  return `${formatTop4List(entryTeams)}\nStatus: **${hits}/4 matched** | Points: **${calculateTop4Points(hits)}**`;
}
function buildPredictionOutcomeLine(row){
  if(row.status!=="SETTLED"||!row.winner_team)return `Outcome: **Pending**`;
  if(isCancelledOutcome(row.winner_team))return "Outcome: **Cancelled** (0)";
  const isCorrect=normalizeTeamToken(row.predicted_team)===normalizeTeamToken(row.winner_team);
  return isCorrect?`Outcome: **Right** (+${MATCH_CORRECT_POINTS})`:`Outcome: **Wrong** (${MATCH_WRONG_POINTS})`;
}
function formatPredictionHistoryLine(row){
  const base=`**Fixture #${row.fixture_number}: ${row.match_label}**\nPick: **${row.predicted_team}**`;
  if(row.status!=="SETTLED"||!row.winner_team)return `${base}\nOutcome: **Pending**\n${row.match_date_label} ${row.match_time_label} IST`;
  if(isCancelledOutcome(row.winner_team))return `${base}\nResult: **Match Cancelled**\nOutcome: **0 points**\n${row.match_date_label} ${row.match_time_label} IST`;
  const isCorrect=normalizeTeamToken(row.predicted_team)===normalizeTeamToken(row.winner_team);
  return `${base}\nWinner: **${formatSettlementOutcome(row.winner_team)}**\nOutcome: **${isCorrect?"Right":"Wrong"}** ${isCorrect?`(+${MATCH_CORRECT_POINTS})`:`(${MATCH_WRONG_POINTS})`}\n${row.match_date_label} ${row.match_time_label} IST`;
}
async function buildPredictionStatsPreviewEmbed(member){
  const avatarUrl=member?.displayAvatarURL?.({extension:"png",size:256})||member?.user?.displayAvatarURL?.({extension:"png",size:256})||null;
  const embed=new EmbedBuilder()
    .setColor(0x0891b2)
    .setTitle("Preview: IPL Prediction Stats")
    .setDescription(`Example stats card for **${member?.displayName||member?.user?.username||"User"}**`)
    .addFields(
      {name:"Overall Points",value:"27",inline:true},
      {name:"Match Points",value:"17",inline:true},
      {name:"Top 4 Points",value:"15",inline:true},
      {name:"Correct / Wrong",value:"9 / 1",inline:true},
      {name:"Settled Match Picks",value:"10",inline:true},
      {name:"Top 4 Hits",value:"3/4",inline:true},
      {name:"Your Top 4 Pick",value:"**1.** SRH\n**2.** RCB\n**3.** CSK\n**4.** MI"},
      {name:"Final Top 4",value:"**1.** MI\n**2.** SRH\n**3.** GT\n**4.** CSK"}
    )
    .setFooter({text:"Preview with dummy data"});
  if(avatarUrl)embed.setThumbnail(avatarUrl);
  return embed;
}
async function buildPredictionLbPreviewEmbed(guild){
  const members=await getPreviewMembers(guild,8);
  const rows=(members.length?members:[null,null,null,null,null]).slice(0,5).map((member,index)=>({
    name:member?.displayName||member?.user?.username||`User ${index+1}`,
    totalPoints:34-(index*4),
    matchPoints:24-(index*3),
    top4Points:index===0?25:index===1?15:0,
    correctPredictions:8-index,
    wrongPredictions:index>2?2:1
  }));
  return new EmbedBuilder()
    .setColor(0x7c3aed)
    .setTitle("Preview: IPL Prediction Leaderboard")
    .setDescription("Sample embed layout with dummy leaderboard data.")
    .addFields(
      {name:"Scoring",value:`Correct: **+${MATCH_CORRECT_POINTS}** | Wrong: **${MATCH_WRONG_POINTS}** | Cancelled: **0** | Top 4: **3/4 = ${TOP4_THREE_HIT_POINTS}**, **4/4 = ${TOP4_FULL_HIT_POINTS}**, **0-2 = 0**`,inline:false},
      {name:"Standings",value:rows.map((row,index)=>`${index===0?"🥇":index===1?"🥈":index===2?"🥉":`**${index+1}.**`} **${row.name}** | **${row.totalPoints} Overall Points**\nMatch Points: ${row.matchPoints} | Top 4 Points: ${row.top4Points} | W/L: ${row.correctPredictions}/${row.wrongPredictions}`).join("\n\n"),inline:false}
    )
    .setFooter({text:"Preview with dummy data"});
}
function getPreviewFixtureBatch(mode="next"){
  const fixtures=readIplFixtures();
  if(!fixtures.length)return [];
  const now=Math.floor(Date.now()/1000);
  const grouped=new Map();
  for(const fixture of fixtures){
    if(!grouped.has(fixture.dateLabel))grouped.set(fixture.dateLabel,[]);
    grouped.get(fixture.dateLabel).push(fixture);
  }
  const batches=[...grouped.values()].map(batch=>batch.sort((a,b)=>a.startsAt-b.startsAt||a.fixtureNumber-b.fixtureNumber));
  if(mode==="double"){
    const futureDouble=batches.find(batch=>batch.length>1&&batch.some(f=>f.deadlineAt>now));
    if(futureDouble)return futureDouble;
    const anyDouble=batches.find(batch=>batch.length>1);
    if(anyDouble)return anyDouble;
  }
  const anchor=fixtures.find(f=>f.deadlineAt>now)||fixtures[0];
  return fixtures.filter(f=>f.dateLabel===anchor.dateLabel).sort((a,b)=>a.startsAt-b.startsAt||a.fixtureNumber-b.fixtureNumber);
}
function buildPredictionPromptPreviewEmbed(match,slot,batchSize){
  const commandLabel=batchSize>1?`?predict${slot}`:"?predict";
  return buildPredictionPromptEmbed(match)
    .setTitle(`Preview: ${commandLabel} | ${match.match_label}`)
    .setFooter({text:"Preview only. Users will see this after running the prediction command."});
}
async function handlePredictionFlowPreviewCommand(message,args){
  const settings=await getPredictionSettings(message.guild.id);
  const announcementRoleIds=parseAnnouncementRoleIds(settings?.announcement_role_ids_json);
  const previewMode=String(args?.[0]||"").trim().toLowerCase();
  const wantsDoubleHeader=["double","doubleheader","dh","2"].includes(previewMode);
  const batchFixtures=getPreviewFixtureBatch(wantsDoubleHeader?"double":"next");
  if(!batchFixtures.length)return message.reply("No IPL fixtures found in `iplmatches.md`.");
  const previewMatches=batchFixtures.map(f=>({
    fixture_number:f.fixtureNumber,
    match_label:f.matchLabel,
    deadline_at:f.deadlineAt,
    starts_at:f.startsAt
  }));
  const summaryEmbed=new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle("Preview: IPL Prediction Announcement + DM")
    .setDescription(`Below is how the public announcement, prediction prompt, and reminder DM will look for the ${wantsDoubleHeader?"double-header":"next"} IPL prediction batch.`)
    .addFields(
      {name:"Announcement Channel",value:settings?.announcement_channel_id?`<#${settings.announcement_channel_id}>`:"Not configured",inline:true},
      {name:"Prediction Channel",value:settings?.channel_id?`<#${settings.channel_id}>`:"Not configured",inline:true},
      {name:"Batch Date",value:batchFixtures[0].dateLabel,inline:true},
      {name:"Batch Type",value:previewMatches.length>1?"Double Header":"Single Match",inline:true},
      {name:"Announcement Ping Roles",value:announcementRoleIds.length?buildAnnouncementRoleMentions(announcementRoleIds):"None",inline:false}
    )
    .setFooter({text:"Preview only. This does not announce or DM anyone."});
  const dmEmbed=buildBatchReminderEmbed(previewMatches,settings?.channel_id||null).setTitle("Preview: Prediction Reminder DM");
  await message.reply({embeds:[summaryEmbed]});
  for(let i=0;i<previewMatches.length;i++){
    await message.channel.send({
      content:buildAnnouncementText(previewMatches[i],i+1,previewMatches.length,settings?.channel_id||null,announcementRoleIds),
      allowedMentions:{parse:[],roles:[]}
    });
    await message.channel.send({embeds:[buildPredictionPromptPreviewEmbed(previewMatches[i],i+1,previewMatches.length)]});
  }
  return message.channel.send({embeds:[dmEmbed]});
}
function chunkArray(items,size){const out=[]; for(let i=0;i<items.length;i+=size)out.push(items.slice(i,i+size)); return out;}
function getPredictSlotFromCommand(command){
  const m=String(command||"").match(/^predict(\d+)$/i);
  return m?parseInt(m[1],10):null;
}
function getWinnerSlotFromCommand(command){
  const m=String(command||"").match(/^iplwinner(\d+)$/i);
  return m?parseInt(m[1],10):null;
}
async function resolveActiveMatchForSlot(guildId,slot){
  const batch=await getActivePredictionBatch(guildId);
  if(!batch.length)return {batch,match:null};
  if(slot==null)return {batch,match:batch.length===1?batch[0]:null};
  if(slot<1||slot>batch.length)return {batch,match:null};
  return {batch,match:batch[slot-1]};
}
async function resolvePendingSettlementMatchForSlot(guildId,slot){
  const batch=await getPendingSettlementBatch(guildId);
  if(!batch.length)return {batch,match:null};
  if(slot==null)return {batch,match:batch.length===1?batch[0]:null};
  if(slot<1||slot>batch.length)return {batch,match:null};
  return {batch,match:batch[slot-1]};
}
async function handleFixturesCommand(message){
  const fixtures=readIplFixtures();
  if(!fixtures.length)return message.reply("No IPL fixtures found in `iplmatches.md`.");
  const now=Math.floor(Date.now()/1000);
  const lines=fixtures.map(f=>`${f.fixtureNumber}. **${f.matchLabel}** | ${f.dateLabel} ${f.timeLabel} IST${f.deadlineAt>now?" | Open":" | Passed"}`);
  const chunks=chunkArray(lines,20);
  const buildEmbed=(page)=>new EmbedBuilder().setColor(0x2563eb).setTitle(`IPL Fixtures${chunks.length>1?` (${page+1}/${chunks.length})`:""}`).setDescription(chunks[page].join("\n"));
  if(chunks.length===1){
    await message.reply({embeds:[buildEmbed(0)]});
    return;
  }
  let page=0;
  const buildRow=(pageIndex)=>new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("iplfx_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(pageIndex===0),
    new ButtonBuilder().setCustomId("iplfx_next").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(pageIndex===chunks.length-1)
  );
  const response=await message.reply({embeds:[buildEmbed(page)],components:[buildRow(page)]});
  const collector=response.createMessageComponentCollector({
    filter:i=>i.user.id===message.author.id&&(i.customId==="iplfx_prev"||i.customId==="iplfx_next"),
    time:300000
  });
  collector.on("collect",async i=>{
    if(i.customId==="iplfx_prev"&&page>0)page--;
    if(i.customId==="iplfx_next"&&page<chunks.length-1)page++;
    await i.update({embeds:[buildEmbed(page)],components:[buildRow(page)]}).catch(()=>null);
  });
  collector.on("end",()=>{response.edit({components:[]}).catch(()=>null);});
}
async function handleMatchReportCommand(message,args){
  const fixtureNumber=parseInt(args[0],10);
  if(!Number.isInteger(fixtureNumber)||fixtureNumber<1)return message.reply("Usage: `?iplmatchreport <fixture number>`");
  const db=getDB();
  const fixture=readIplFixtures().find(f=>f.fixtureNumber===fixtureNumber)||null;
  const match=await db.get("SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND fixture_number = ?",message.guild.id,fixtureNumber);
  if(!fixture&&!match)return message.reply(`Fixture **${fixtureNumber}** was not found.`);
  if(!match){
    return message.reply({embeds:[new EmbedBuilder().setColor(0x6b7280).setTitle(`IPL Match Report: Fixture #${fixtureNumber}`).setDescription(`**${fixture.matchLabel}**\n${fixture.dateLabel} ${fixture.timeLabel} IST`).addFields({name:"Prediction Status",value:"Not announced in the bot yet."})]});
  }
  const entries=await db.all("SELECT user_id, predicted_team FROM ipl_prediction_entries WHERE match_id = ? ORDER BY predicted_at ASC, user_id ASC",match.id);
  const teamAUsers=entries.filter(e=>normalizeTeamToken(e.predicted_team)===normalizeTeamToken(match.team_a)).map(e=>`<@${e.user_id}>`);
  const teamBUsers=entries.filter(e=>normalizeTeamToken(e.predicted_team)===normalizeTeamToken(match.team_b)).map(e=>`<@${e.user_id}>`);
  const statusLabel=match.status==="SETTLED"?(isCancelledOutcome(match.winner_team)?"Settled | Result: **Match Cancelled**":`Settled | Winner: **${formatSettlementOutcome(match.winner_team)}**`):`Open | Deadline: **${formatIst(match.deadline_at)}**`;
  const embed=new EmbedBuilder().setColor(match.status==="SETTLED"?0xf59e0b:0x2563eb).setTitle(`IPL Match Report: Fixture #${match.fixture_number}`).setDescription(`**${match.match_label}**\n${match.match_date_label} ${match.match_time_label} IST`).addFields({name:"Status",value:statusLabel,inline:false},{name:`${match.team_a} Pickers (${teamAUsers.length})`,value:teamAUsers.length?teamAUsers.join(", ").slice(0,1024):"No picks",inline:false},{name:`${match.team_b} Pickers (${teamBUsers.length})`,value:teamBUsers.length?teamBUsers.join(", ").slice(0,1024):"No picks",inline:false});
  if(match.announce_channel_id)embed.addFields({name:"Announced In",value:`<#${match.announce_channel_id}>`,inline:true});
  embed.addFields({name:"Total Entries",value:String(entries.length),inline:true});
  await message.reply({embeds:[embed]});
}
async function handleDayPicksCommand(message,args){
  const db=getDB(), guildId=message.guild.id, fixtures=readIplFixtures();
  const requestedFixture=parseInt(args[0],10);
  let matches=[];
  let targetDateLabel=null;
  if(args.length>0){
    if(!Number.isInteger(requestedFixture)||requestedFixture<1)return message.reply("Usage: `?ipldaypicks [fixture number]`");
    const fixture=fixtures.find(f=>f.fixtureNumber===requestedFixture)||null;
    if(!fixture)return message.reply(`Fixture **${requestedFixture}** was not found in \`iplmatches.md\`.`);
    targetDateLabel=fixture.dateLabel;
    matches=await db.all("SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND match_date_label = ? ORDER BY starts_at ASC, id ASC",guildId,targetDateLabel);
    if(!matches.length)return message.reply(`No announced prediction batch was found for **${targetDateLabel}** yet.`);
  }else{
    matches=await getActivePredictionBatch(guildId);
    if(!matches.length)return message.reply("There is no active IPL prediction day right now. Use `?ipldaypicks <fixture number>` to inspect a specific announced day.");
    targetDateLabel=matches[0].match_date_label;
  }
  const entries=await db.all(`
    SELECT e.user_id, e.predicted_team, m.id as match_id, m.fixture_number, m.match_label
    FROM ipl_prediction_entries e
    JOIN ipl_prediction_matches m ON m.id = e.match_id
    WHERE m.guild_id = ? AND m.match_date_label = ?
    ORDER BY m.starts_at ASC, m.id ASC, e.predicted_at ASC, e.user_id ASC
  `,guildId,targetDateLabel);
  if(!entries.length)return message.reply(`No player picks have been submitted for **${targetDateLabel}** yet.`);
  const matchesById=new Map(matches.map(match=>[match.id,match]));
  const picksByUser=new Map();
  for(const entry of entries){
    if(!picksByUser.has(entry.user_id))picksByUser.set(entry.user_id,new Map());
    picksByUser.get(entry.user_id).set(entry.match_id,normalizeTeamToken(entry.predicted_team));
  }
  const userRows=await Promise.all([...picksByUser.entries()].map(async([userId,userPicks])=>{
    const member=await message.guild.members.fetch(userId).catch(()=>null);
    const user=member?.user||await message.client.users.fetch(userId).catch(()=>null);
    const displayName=(member?.displayName||user?.username||userId).trim();
    const pickSummary=matches.map((match,index)=>{
      const predictedTeam=userPicks.get(match.id)||"No Pick";
      if(matches.length===1)return `Pick: **${predictedTeam}**`;
      return `M${index+1}: **${predictedTeam}**`;
    }).join(" | ");
    return {displayName,userId,summary:`**${displayName}** (<@${userId}>)\n${pickSummary}`};
  }));
  userRows.sort((a,b)=>a.displayName.localeCompare(b.displayName,undefined,{sensitivity:"base"}));
  const pages=chunkArray(userRows.map(row=>row.summary),10);
  const matchSummary=matches.map((match,index)=>`${matches.length===1?"Match":`Match ${index+1}`}: **${match.match_label}**`).join("\n");
  const buildEmbed=(pageIndex)=>new EmbedBuilder()
    .setColor(0x2563eb)
    .setTitle(`IPL Day Picks${pages.length>1?` (${pageIndex+1}/${pages.length})`:""}`)
    .setDescription(`**Date:** ${targetDateLabel}\n${matchSummary}\n\n${pages[pageIndex].join("\n\n")}`)
    .addFields({name:"Total Predictors",value:String(userRows.length),inline:true})
    .setFooter({text:`Players shown in alphabetical order | 10 per page`});
  if(pages.length===1){
    await message.reply({embeds:[buildEmbed(0)]});
    return;
  }
  let page=0;
  const buildRow=(pageIndex)=>new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ipldaypicks_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(pageIndex===0),
    new ButtonBuilder().setCustomId("ipldaypicks_next").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(pageIndex===pages.length-1)
  );
  const response=await message.reply({embeds:[buildEmbed(page)],components:[buildRow(page)]});
  const collector=response.createMessageComponentCollector({
    filter:i=>i.user.id===message.author.id&&(i.customId==="ipldaypicks_prev"||i.customId==="ipldaypicks_next"),
    time:300000
  });
  collector.on("collect",async i=>{
    if(i.customId==="ipldaypicks_prev"&&page>0)page--;
    if(i.customId==="ipldaypicks_next"&&page<pages.length-1)page++;
    await i.update({embeds:[buildEmbed(page)],components:[buildRow(page)]}).catch(()=>null);
  });
  collector.on("end",()=>{response.edit({components:[]}).catch(()=>null);});
}
async function handleTop4PicksCommand(message){
  const db=getDB();
  const rows=await db.all(`
    SELECT user_id, slot_1_team, slot_2_team, slot_3_team, slot_4_team, submitted_at
    FROM ipl_top4_entries
    WHERE guild_id = ?
    ORDER BY submitted_at ASC, user_id ASC
  `,message.guild.id);
  if(!rows.length)return message.reply("No Top 4 predictions have been submitted yet.");
  const userRows=await Promise.all(rows.map(async row=>{
    const member=await message.guild.members.fetch(row.user_id).catch(()=>null);
    const user=member?.user||await message.client.users.fetch(row.user_id).catch(()=>null);
    const displayName=(member?.displayName||user?.username||row.user_id).trim();
    const top4Summary=[row.slot_1_team,row.slot_2_team,row.slot_3_team,row.slot_4_team].map((team,index)=>`**${index+1}.** ${normalizeTeamToken(team)}`).join(" | ");
    return {displayName,summary:`**${displayName}** (<@${row.user_id}>)\n${top4Summary}`};
  }));
  userRows.sort((a,b)=>a.displayName.localeCompare(b.displayName,undefined,{sensitivity:"base"}));
  const top4Result=await getTop4Result(message.guild.id);
  const pages=chunkArray(userRows.map(row=>row.summary),10);
  const buildEmbed=(pageIndex)=>new EmbedBuilder()
    .setColor(0xea580c)
    .setTitle(`IPL Top 4 Picks${pages.length>1?` (${pageIndex+1}/${pages.length})`:""}`)
    .setDescription(`${top4Result?"Final Top 4 has already been settled.":"Final Top 4 is not settled yet."}\n\n${pages[pageIndex].join("\n\n")}`)
    .addFields({name:"Total Predictors",value:String(userRows.length),inline:true})
    .setFooter({text:"Players shown in alphabetical order | 10 per page"});
  if(pages.length===1){
    const embed=buildEmbed(0);
    if(top4Result)embed.addFields({name:"Final Top 4",value:formatTop4List([top4Result.slot_1_team,top4Result.slot_2_team,top4Result.slot_3_team,top4Result.slot_4_team]),inline:false});
    await message.reply({embeds:[embed]});
    return;
  }
  let page=0;
  const buildRow=(pageIndex)=>new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("ipltop4picks_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(pageIndex===0),
    new ButtonBuilder().setCustomId("ipltop4picks_next").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(pageIndex===pages.length-1)
  );
  const buildPageEmbed=(pageIndex)=>{
    const embed=buildEmbed(pageIndex);
    if(top4Result&&pageIndex===0)embed.addFields({name:"Final Top 4",value:formatTop4List([top4Result.slot_1_team,top4Result.slot_2_team,top4Result.slot_3_team,top4Result.slot_4_team]),inline:false});
    return embed;
  };
  const response=await message.reply({embeds:[buildPageEmbed(page)],components:[buildRow(page)]});
  const collector=response.createMessageComponentCollector({
    filter:i=>i.user.id===message.author.id&&(i.customId==="ipltop4picks_prev"||i.customId==="ipltop4picks_next"),
    time:300000
  });
  collector.on("collect",async i=>{
    if(i.customId==="ipltop4picks_prev"&&page>0)page--;
    if(i.customId==="ipltop4picks_next"&&page<pages.length-1)page++;
    await i.update({embeds:[buildPageEmbed(page)],components:[buildRow(page)]}).catch(()=>null);
  });
  collector.on("end",()=>{response.edit({components:[]}).catch(()=>null);});
}

async function handleSetChannelCommand(message){
  const mentionedChannel=message.mentions.channels.first();
  if(mentionedChannel){
    if(mentionedChannel.type!==ChannelType.GuildText)return message.reply("Please mention a text channel for IPL predictions.");
    if(!await askConfirmation(message,`Set the IPL prediction channel to ${mentionedChannel}?`))return null;
    await savePredictionSettings(message.guild.id,{channel_id:mentionedChannel.id});
    return message.reply(`IPL prediction channel set to ${mentionedChannel}.`);
  }
  const categoryOptions=message.guild.channels.cache
    .filter(channel=>channel.type===ChannelType.GuildCategory)
    .sort((a,b)=>a.rawPosition-b.rawPosition||a.name.localeCompare(b.name))
    .map(channel=>({label:channel.name.slice(0,100)||"Unnamed Category",value:channel.id}))
    .slice(0,25);
  if(!categoryOptions.length)return message.reply("No categories found in this server.");
  const categoryRow=new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ipl_predict_category_select")
      .setPlaceholder("Select Category")
      .addOptions(categoryOptions)
  );
  const prompt=await message.reply({
    content:"Select a **category** for the IPL prediction channel.",
    components:[categoryRow]
  });
  const categoryCollector=prompt.createMessageComponentCollector({
    filter:interaction=>interaction.user.id===message.author.id&&interaction.customId==="ipl_predict_category_select",
    componentType:3,
    time:60000,
    max:1
  });
  categoryCollector.on("collect",async interaction=>{
    const categoryId=interaction.values?.[0];
    const channelOptions=message.guild.channels.cache
      .filter(channel=>channel.parentId===categoryId&&channel.type===ChannelType.GuildText)
      .sort((a,b)=>a.rawPosition-b.rawPosition||a.name.localeCompare(b.name))
      .map(channel=>({label:channel.name.slice(0,100)||"unnamed-channel",value:channel.id}))
      .slice(0,25);
    if(!channelOptions.length){
      await interaction.update({content:"No text channels found in that category.",components:[]}).catch(()=>null);
      return;
    }
    const channelRow=new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ipl_predict_channel_select")
        .setPlaceholder("Select Channel")
        .addOptions(channelOptions)
    );
    await interaction.update({
      content:"Select the **IPL prediction channel**.",
      components:[channelRow]
    }).catch(()=>null);
    const channelCollector=prompt.createMessageComponentCollector({
      filter:nextInteraction=>nextInteraction.user.id===message.author.id&&nextInteraction.customId==="ipl_predict_channel_select",
      componentType:3,
      time:60000,
      max:1
    });
    channelCollector.on("collect",async nextInteraction=>{
      const selectedChannel=await message.guild.channels.fetch(nextInteraction.values?.[0]).catch(()=>null);
      if(!selectedChannel||selectedChannel.type!==ChannelType.GuildText){
        await nextInteraction.update({content:"Invalid IPL prediction channel selected.",components:[]}).catch(()=>null);
        return;
      }
      await nextInteraction.update({content:`Selected IPL prediction channel: ${selectedChannel}. Waiting for confirmation...`,components:[]}).catch(()=>null);
      if(!await askConfirmation(message,`Set the IPL prediction channel to ${selectedChannel}?`))return;
      await savePredictionSettings(message.guild.id,{channel_id:selectedChannel.id});
      await message.reply(`IPL prediction channel set to ${selectedChannel}.`).catch(()=>null);
    });
    channelCollector.on("end",async collected=>{
      if(collected.size)return;
      await prompt.edit({content:"Channel selection timed out.",components:[]}).catch(()=>null);
    });
  });
  categoryCollector.on("end",async collected=>{
    if(collected.size)return;
    await prompt.edit({content:"Category selection timed out.",components:[]}).catch(()=>null);
  });
  return null;
}
async function handleSetAnnouncementChannelCommand(message){
  const mentionedChannel=message.mentions.channels.first();
  if(mentionedChannel){
    if(mentionedChannel.type!==ChannelType.GuildText)return message.reply("Please mention a text channel for IPL announcements.");
    if(!await askConfirmation(message,`Set the IPL announcement channel to ${mentionedChannel}?`))return null;
    await savePredictionSettings(message.guild.id,{announcement_channel_id:mentionedChannel.id});
    return message.reply(`IPL announcement channel set to ${mentionedChannel}.`);
  }
  const categoryOptions=message.guild.channels.cache
    .filter(channel=>channel.type===ChannelType.GuildCategory)
    .sort((a,b)=>a.rawPosition-b.rawPosition||a.name.localeCompare(b.name))
    .map(channel=>({label:channel.name.slice(0,100)||"Unnamed Category",value:channel.id}))
    .slice(0,25);
  if(!categoryOptions.length)return message.reply("No categories found in this server.");
  const categoryRow=new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId("ipl_announce_category_select")
      .setPlaceholder("Select Category")
      .addOptions(categoryOptions)
  );
  const prompt=await message.reply({
    content:"Select a **category** for the IPL announcement channel.",
    components:[categoryRow]
  });
  const categoryCollector=prompt.createMessageComponentCollector({
    filter:interaction=>interaction.user.id===message.author.id&&interaction.customId==="ipl_announce_category_select",
    componentType:3,
    time:60000,
    max:1
  });
  categoryCollector.on("collect",async interaction=>{
    const categoryId=interaction.values?.[0];
    const channelOptions=message.guild.channels.cache
      .filter(channel=>channel.parentId===categoryId&&channel.type===ChannelType.GuildText)
      .sort((a,b)=>a.rawPosition-b.rawPosition||a.name.localeCompare(b.name))
      .map(channel=>({label:channel.name.slice(0,100)||"unnamed-channel",value:channel.id}))
      .slice(0,25);
    if(!channelOptions.length){
      await interaction.update({content:"No text channels found in that category.",components:[]}).catch(()=>null);
      return;
    }
    const channelRow=new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ipl_announce_channel_select")
        .setPlaceholder("Select Channel")
        .addOptions(channelOptions)
    );
    await interaction.update({
      content:"Select the **IPL announcement channel**.",
      components:[channelRow]
    }).catch(()=>null);
    const channelCollector=prompt.createMessageComponentCollector({
      filter:nextInteraction=>nextInteraction.user.id===message.author.id&&nextInteraction.customId==="ipl_announce_channel_select",
      componentType:3,
      time:60000,
      max:1
    });
    channelCollector.on("collect",async nextInteraction=>{
      const selectedChannel=await message.guild.channels.fetch(nextInteraction.values?.[0]).catch(()=>null);
      if(!selectedChannel||selectedChannel.type!==ChannelType.GuildText){
        await nextInteraction.update({content:"Invalid IPL announcement channel selected.",components:[]}).catch(()=>null);
        return;
      }
      await nextInteraction.update({content:`Selected IPL announcement channel: ${selectedChannel}. Waiting for confirmation...`,components:[]}).catch(()=>null);
      if(!await askConfirmation(message,`Set the IPL announcement channel to ${selectedChannel}?`))return;
      await savePredictionSettings(message.guild.id,{announcement_channel_id:selectedChannel.id});
      await message.reply(`IPL announcement channel set to ${selectedChannel}.`).catch(()=>null);
    });
    channelCollector.on("end",async collected=>{
      if(collected.size)return;
      await prompt.edit({content:"Channel selection timed out.",components:[]}).catch(()=>null);
    });
  });
  categoryCollector.on("end",async collected=>{
    if(collected.size)return;
    await prompt.edit({content:"Category selection timed out.",components:[]}).catch(()=>null);
  });
  return null;
}
async function handleSetAnnouncementPingRolesCommand(message){
  const mentionedRoles=[...message.mentions.roles.values()];
  if(!mentionedRoles.length){
    if(!await askConfirmation(message,"Clear all IPL announcement ping roles?"))return null;
    await savePredictionSettings(message.guild.id,{announcement_role_ids_json:JSON.stringify([])});
    return message.reply("IPL announcement ping roles cleared. Future announcements will not ping any roles.");
  }
  const uniqueRoles=[...new Map(mentionedRoles.map(role=>[role.id,role])).values()];
  const roleSummary=uniqueRoles.map(role=>role.toString()).join(", ");
  if(!await askConfirmation(message,`Set the IPL announcement ping roles to ${roleSummary}?`))return null;
  await savePredictionSettings(message.guild.id,{announcement_role_ids_json:JSON.stringify(uniqueRoles.map(role=>role.id))});
  return message.reply(`IPL announcement ping roles saved: ${roleSummary}`);
}
async function announceFixtureBatch(guild,settings,batchFixtures,announcedById,targetChannel,predictionChannel){
  const db=getDB(), guildId=guild.id, now=Math.floor(Date.now()/1000);
  const summaryLines=[];
  const createdMatches=[];
  const announcementRoleIds=parseAnnouncementRoleIds(settings?.announcement_role_ids_json);
  for(let i=0;i<batchFixtures.length;i++){
    const f=batchFixtures[i];
    const res=await db.run(`INSERT INTO ipl_prediction_matches (guild_id, fixture_key, fixture_number, match_label, team_a, team_b, match_date_label, match_day_label, match_time_label, starts_at, deadline_at, announce_channel_id, status, announced_by, announced_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'ANNOUNCED', ?, ?)`,guildId,f.fixtureKey,f.fixtureNumber,f.matchLabel,f.teamA,f.teamB,f.dateLabel,f.dayLabel,f.timeLabel,f.startsAt,f.deadlineAt,targetChannel.id,announcedById||guild.client.user?.id||"AUTO",now);
    const commandLabel=batchFixtures.length>1?`?predict${i+1}`:"?predict";
    const posted=await targetChannel.send({
      content:buildAnnouncementText({fixture_number:f.fixtureNumber,match_label:f.matchLabel,starts_at:f.startsAt,deadline_at:f.deadlineAt},i+1,batchFixtures.length,predictionChannel.id,announcementRoleIds),
      allowedMentions:{parse:[],roles:announcementRoleIds}
    });
    await db.run("UPDATE ipl_prediction_matches SET announce_message_id = ? WHERE id = ?",posted.id,res?.lastID);
    createdMatches.push({id:res?.lastID,fixture_number:f.fixtureNumber,match_label:f.matchLabel,starts_at:f.startsAt,deadline_at:f.deadlineAt});
    summaryLines.push(`${batchFixtures.length>1?`Match ${i+1}: `:""}**${f.matchLabel}** | Deadline: **${formatIst(f.deadlineAt)}** | Announced in ${targetChannel} | Predict in ${predictionChannel} with \`${commandLabel}\``);
  }
  return {summaryLines,createdMatches};
}
async function handleAnnounceCommand(message,args){
  const db=getDB(), guildId=message.guild.id, settings=await getPredictionSettings(guildId);
  if(!settings?.channel_id)return message.reply("Set the IPL prediction channel first with `?setiplpredictchannel`.");
  if(!settings?.announcement_channel_id)return message.reply("Set the IPL announcement channel first with `?setiplannouncechannel`.");
  const existingBatch=await getActivePredictionBatch(guildId);
  if(existingBatch.length)return message.reply(`IPL predictions are still active for **${existingBatch[0].match_date_label}**. Finish the current announced match batch first before announcing the next date.`);
  const fixtures=readIplFixtures(), fixture=resolveFixtureSelection(fixtures,args);
  if(!fixture)return message.reply("No valid fixture found. Use `?announceipl next` or `?announceipl <fixture number>`.");
  const predictionChannel=await message.guild.channels.fetch(settings.channel_id).catch(()=>null);
  if(!predictionChannel||!predictionChannel.isTextBased?.())return message.reply("The saved IPL prediction channel is no longer available. Set it again with `?setiplpredictchannel`.");
  const targetChannel=await message.guild.channels.fetch(settings.announcement_channel_id).catch(()=>null);
  if(!targetChannel||!targetChannel.isTextBased?.())return message.reply("The saved IPL announcement channel is no longer available. Set it again with `?setiplannouncechannel`.");
  const now=Math.floor(Date.now()/1000);
  const batchFixtures=fixtures.filter(f=>f.dateLabel===fixture.dateLabel).sort((a,b)=>a.startsAt-b.startsAt||a.fixtureNumber-b.fixtureNumber);
  if(batchFixtures.some(f=>f.deadlineAt<=now))return message.reply(`One or more fixtures on **${fixture.dateLabel}** have already passed their prediction deadlines.`);
  for(const f of batchFixtures){
    const duplicate=await db.get("SELECT * FROM ipl_prediction_matches WHERE guild_id = ? AND fixture_key = ?",guildId,f.fixtureKey);
    if(duplicate)return message.reply(`Fixture #${f.fixtureNumber} is already recorded as **${duplicate.match_label}**.`);
  }
  const previewLines=batchFixtures.map((f,i)=>`${batchFixtures.length>1?`Match ${i+1}: `:""}**${f.matchLabel}** | Deadline: **${formatIst(f.deadlineAt)}** | Announce: ${targetChannel} | Predict: ${predictionChannel}`);
  if(!await askConfirmation(message,`Announce the following IPL fixture batch?\n${previewLines.join("\n")}`))return null;
  const {summaryLines,createdMatches}=await announceFixtureBatch(message.guild,settings,batchFixtures,message.author.id,targetChannel,predictionChannel);
  const reminderStats=await sendBatchReminderDms(message.guild,settings,createdMatches);
  const reminderLine=settings?.reminder_role_id?`\nDM reminders: **${reminderStats.sent} sent**, **${reminderStats.failed} failed**, **${reminderStats.skipped} skipped**.`:"";
  return message.reply(`Announced IPL fixture batch for **${fixture.dateLabel}** in ${targetChannel}.\n${summaryLines.join("\n")}${reminderLine}`);
}
async function settlePredictionMatch(guild,match,outcome,fallbackChannelId){
  const db=getDB(), now=Math.floor(Date.now()/1000), resolvedOutcome=normalizeSettlementOutcome(outcome);
  await db.run(`UPDATE ipl_prediction_matches SET winner_team = ?, status = 'SETTLED', settled_at = ? WHERE id = ?`,resolvedOutcome,now,match.id);
  const totalRow=await db.get("SELECT COUNT(*) AS count FROM ipl_prediction_entries WHERE match_id = ?",match.id);
  const total=Number(totalRow?.count||0);
  let correct=0, wrong=0;
  if(!isCancelledOutcome(resolvedOutcome)){
    const correctRow=await db.get("SELECT COUNT(*) AS count FROM ipl_prediction_entries WHERE match_id = ? AND UPPER(predicted_team) = UPPER(?)",match.id,resolvedOutcome);
    correct=Number(correctRow?.count||0);
    wrong=Math.max(0,total-correct);
  }
  const updated=await db.get("SELECT * FROM ipl_prediction_matches WHERE id = ?",match.id);
  const target=await guild.channels.fetch(updated?.announce_channel_id||fallbackChannelId).catch(()=>null);
  if(target&&target.isTextBased?.()){
    await target.send({embeds:[buildResultEmbed(updated,correct,wrong,total)]}).catch(()=>null);
    await target.send(await buildLeaderboardPayload(guild)).catch(()=>null);
  }
  return {updated,total,correct,wrong};
}
async function launchSettlementManager(message,mode,prefillMatchId=null){
  const guildId=message.guild.id;
  const matches=mode==="edit"?await getSettledPredictionMatches(guildId):await getPendingSettlementMatches(guildId);
  if(!matches.length){
    return message.reply(mode==="edit"?"There are no settled IPL matches available to edit.":"There are no overdue IPL matches waiting for a result.");
  }
  let page=0;
  let selectedMatch=matches.find(match=>String(match.id)===String(prefillMatchId||""))||matches[0];
  let selectedOutcome=null;
  page=Math.floor(Math.max(matches.findIndex(match=>match.id===selectedMatch.id),0)/25);
  const buildPayload=()=>({
    embeds:[buildSettlementManagerEmbed(mode,matches,page,selectedMatch,selectedOutcome)],
    components:buildSettlementManagerComponents(mode,matches,page,selectedMatch,selectedOutcome)
  });
  const response=await message.reply(buildPayload());
  const collector=response.createMessageComponentCollector({
    filter:i=>i.user.id===message.author.id&&(
      i.customId==="ipl_settlement_match_select"||
      i.customId==="ipl_settlement_outcome_team_a"||
      i.customId==="ipl_settlement_outcome_team_b"||
      i.customId==="ipl_settlement_outcome_cancelled"||
      i.customId==="ipl_settlement_prev_page"||
      i.customId==="ipl_settlement_next_page"||
      i.customId==="ipl_settlement_confirm"||
      i.customId==="ipl_settlement_cancel"
    ),
    time:300000
  });
  collector.on("collect",async interaction=>{
    if(interaction.customId==="ipl_settlement_cancel"){
      collector.stop("cancelled");
      await interaction.update({embeds:[new EmbedBuilder().setColor(0x6b7280).setTitle(mode==="edit"?"IPL Result Edit Cancelled":"IPL Settlement Cancelled").setDescription("No IPL result changes were made.")],components:[]}).catch(()=>null);
      return;
    }
    if(interaction.customId==="ipl_settlement_prev_page"&&page>0){
      page--;
      await interaction.update(buildPayload()).catch(()=>null);
      return;
    }
    if(interaction.customId==="ipl_settlement_next_page"&&page<Math.max(Math.ceil(matches.length/25),1)-1){
      page++;
      await interaction.update(buildPayload()).catch(()=>null);
      return;
    }
    if(interaction.customId==="ipl_settlement_match_select"){
      const nextMatch=matches.find(match=>String(match.id)===String(interaction.values?.[0]||""))||selectedMatch;
      selectedMatch=nextMatch;
      selectedOutcome=mode==="edit"&&selectedMatch?normalizeSettlementOutcome(selectedMatch.winner_team):null;
      page=Math.floor(Math.max(matches.findIndex(match=>match.id===selectedMatch.id),0)/25);
      await interaction.update(buildPayload()).catch(()=>null);
      return;
    }
    if(interaction.customId==="ipl_settlement_outcome_team_a"&&selectedMatch)selectedOutcome=normalizeTeamToken(selectedMatch.team_a);
    if(interaction.customId==="ipl_settlement_outcome_team_b"&&selectedMatch)selectedOutcome=normalizeTeamToken(selectedMatch.team_b);
    if(interaction.customId==="ipl_settlement_outcome_cancelled"&&selectedMatch)selectedOutcome=MATCH_CANCELLED_OUTCOME;
    if(interaction.customId.startsWith("ipl_settlement_outcome_")){
      await interaction.update(buildPayload()).catch(()=>null);
      return;
    }
    if(interaction.customId==="ipl_settlement_confirm"){
      if(!selectedMatch||!selectedOutcome){
        await interaction.reply({content:"Select a match and result first.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null);
        return;
      }
      const freshMatch=await getDB().get("SELECT * FROM ipl_prediction_matches WHERE id = ? AND guild_id = ?",selectedMatch.id,guildId);
      if(!freshMatch){
        await interaction.reply({content:"That IPL match no longer exists.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null);
        return;
      }
      const now=Math.floor(Date.now()/1000);
      if(mode!=="edit"&&freshMatch.status==="SETTLED"){
        await interaction.reply({content:"That match has already been settled. Run `?ipw` again to refresh the list.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null);
        return;
      }
      if(mode!=="edit"&&now<freshMatch.deadline_at){
        await interaction.reply({content:`Predictions are still open for **${freshMatch.match_label}** until **${formatIst(freshMatch.deadline_at)}**.`,flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null);
        return;
      }
      if(mode==="edit"&&freshMatch.status!=="SETTLED"){
        await interaction.reply({content:"That match is not settled yet, so use `?ipw` instead.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null);
        return;
      }
      const previousOutcome=freshMatch.winner_team||null;
      const {updated}=await settlePredictionMatch(message.guild,freshMatch,selectedOutcome,message.channel.id);
      await appendAdminAuditLog({
        guildId,
        actorId:message.author.id,
        commandName:mode==="edit"?"editiplwinner":"iplwinner",
        summary:mode==="edit"?`Edited ${freshMatch.match_label} from ${formatSettlementOutcome(previousOutcome)} to ${formatSettlementOutcome(updated.winner_team)}.`:`Settled ${freshMatch.match_label} with ${formatSettlementOutcome(updated.winner_team)}.`,
        targetSummary:`Fixture #${freshMatch.fixture_number}`,
        channelId:message.channel.id
      });
      collector.stop("completed");
      await interaction.update({embeds:[buildSettlementSuccessEmbed(updated,updated.winner_team,mode,previousOutcome)],components:[]}).catch(()=>null);
    }
  });
  collector.on("end",(_collected,reason)=>{
    if(reason==="completed"||reason==="cancelled")return;
    response.edit({components:[]}).catch(()=>null);
  });
  return response;
}
async function handleWinnerCommand(message,args){
  const db=getDB(), guildId=message.guild.id;
  const commandSlot=getWinnerSlotFromCommand(message.content.trim().split(/\s+/)[0].replace(/^\?/,""));
  const argSlot=commandSlot==null?parseInt(args[0],10):null;
  const effectiveSlot=commandSlot??(!Number.isNaN(argSlot)?argSlot:null);
  const winnerArgs=effectiveSlot!=null&&commandSlot==null&&!Number.isNaN(argSlot)?args.slice(1):args;
  if(!winnerArgs.length){
    const prefetched=await resolvePendingSettlementMatchForSlot(guildId,effectiveSlot);
    return launchSettlementManager(message,"settle",prefetched.match?.id||null);
  }
  const {batch,match}=await resolvePendingSettlementMatchForSlot(guildId,effectiveSlot);
  if(!batch.length)return message.reply("There is no overdue IPL prediction match to settle.");
  if(!match){
    if(batch.length>1)return message.reply(`Two overdue matches are waiting for results on **${batch[0].match_date_label}**. Use \`?iplwinner1 TEAM\` or \`?iplwinner2 TEAM\`, or just run \`?ipw\` to use the picker.`);
    return message.reply("There is no overdue IPL prediction match to settle.");
  }
  const now=Math.floor(Date.now()/1000);
  if(now<match.deadline_at)return message.reply(`Predictions are still open for **${match.match_label}** until **${formatIst(match.deadline_at)}**.`);
  const winner=normalizeSettlementOutcome(winnerArgs.join(" "));
  if(!winner)return message.reply({embeds:[buildSettlementPromptEmbed(match)],components:buildSettlementButtons(match)});
  if(![normalizeTeamToken(match.team_a),normalizeTeamToken(match.team_b),MATCH_CANCELLED_OUTCOME].includes(winner))return message.reply(`Winner must be **${match.team_a}**, **${match.team_b}**, or **match cancelled** for **${match.match_label}**.`);
  if(!await askConfirmation(message,isCancelledOutcome(winner)?`Mark **${match.match_label}** as **Match Cancelled**? All predictions will get **0 points**.`:`Settle **${match.match_label}** with winner **${formatSettlementOutcome(winner)}**?`))return null;
  const {updated}=await settlePredictionMatch(message.guild,match,winner,message.channel.id);
  await appendAdminAuditLog({
    guildId,
    actorId:message.author.id,
    commandName:"iplwinner",
    summary:`Settled ${match.match_label} with ${formatSettlementOutcome(updated.winner_team)}.`,
    targetSummary:`Fixture #${match.fixture_number}`,
    channelId:message.channel.id
  });
  return message.reply(isCancelledOutcome(updated.winner_team)?`Saved result for **${match.match_label}**: **Match Cancelled**.`:`Winner saved for **${match.match_label}**: **${formatSettlementOutcome(updated.winner_team)}**.`);
}
async function handleEditWinnerCommand(message){
  return launchSettlementManager(message,"edit");
}
async function handleTop4ResultCommand(message,args){
  const parsed=parseTop4Teams(args); if(!parsed.ok)return message.reply(parsed.message);
  const validTeams=getValidTeamsFromFixtures(readIplFixtures()), invalid=parsed.teams.find(t=>!validTeams.has(t));
  if(invalid)return message.reply(`Unknown IPL team code: **${invalid}**.`);
  if(!await askConfirmation(message,`Set the final IPL Top 4 to:\n${formatTop4List(parsed.teams)}\n\nOrder does not matter for scoring.`))return null;
  const db=getDB(), now=Math.floor(Date.now()/1000);
  await db.run(`INSERT INTO ipl_top4_results (guild_id, slot_1_team, slot_2_team, slot_3_team, slot_4_team, settled_by, settled_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET slot_1_team=excluded.slot_1_team, slot_2_team=excluded.slot_2_team, slot_3_team=excluded.slot_3_team, slot_4_team=excluded.slot_4_team, settled_by=excluded.settled_by, settled_at=excluded.settled_at`,message.guild.id,parsed.teams[0],parsed.teams[1],parsed.teams[2],parsed.teams[3],message.author.id,now);
  const settings=await getPredictionSettings(message.guild.id), target=settings?.channel_id?await message.guild.channels.fetch(settings.channel_id).catch(()=>null):null;
  if(target&&target.isTextBased?.()){await target.send({embeds:[buildTop4ResultEmbed(parsed.teams)]}).catch(()=>null); await target.send(await buildLeaderboardPayload(message.guild)).catch(()=>null);}
  await appendAdminAuditLog({
    guildId:message.guild.id,
    actorId:message.author.id,
    commandName:"ipltop4result",
    summary:"Settled the final IPL Top 4.",
    targetSummary:parsed.teams.join(", "),
    channelId:message.channel.id
  });
  return message.reply(`Final IPL Top 4 saved.\n${formatTop4List(parsed.teams)}`);
}
async function handleGuideCommand(message){
  const mentionedChannel=message.mentions.channels.first();
  const settings=await getPredictionSettings(message.guild.id);
  const targetChannel=mentionedChannel&&mentionedChannel.type===ChannelType.GuildText?mentionedChannel:message.channel;
  if(!await askConfirmation(message,`Post the IPL prediction guide in ${targetChannel}?`))return null;
  await targetChannel.send({embeds:buildGuideEmbeds(settings?.channel_id||null)});
  if(targetChannel.id!==message.channel.id)return message.reply(`Posted the IPL prediction guide in ${targetChannel}.`);
  return null;
}
async function handleReminderPanelCommand(message,args){
  const settings=await getPredictionSettings(message.guild.id);
  if(!message.guild.members.me?.permissions.has("ManageRoles"))return message.reply("I need the **Manage Roles** permission to run the IPL DM reminder panel.");
  const targetChannel=message.mentions.channels.first()&&message.mentions.channels.first().type===ChannelType.GuildText?message.mentions.channels.first():message.channel;
  const role=await ensureReminderRole(message.guild,settings);
  let panelMessage=null;
  if(settings?.reminder_panel_channel_id&&settings?.reminder_panel_message_id){
    const existingChannel=await message.guild.channels.fetch(settings.reminder_panel_channel_id).catch(()=>null);
    if(existingChannel?.isTextBased?.()){
      panelMessage=await existingChannel.messages.fetch(settings.reminder_panel_message_id).catch(()=>null);
    }
  }
  const embed=buildReminderPanelEmbed(role.id,settings?.channel_id||null);
  if(panelMessage&&panelMessage.channel.id===targetChannel.id){
    await panelMessage.edit({embeds:[embed]}).catch(()=>null);
  }else{
    panelMessage=await targetChannel.send({embeds:[embed]}).catch(()=>null);
  }
  if(!panelMessage)return message.reply("Failed to post the IPL reminder panel.");
  try{
    const existingBell=panelMessage.reactions.cache.find(reaction=>reaction.emoji?.name===REMINDER_REACTION_EMOJI);
    if(!existingBell)await panelMessage.react(REMINDER_REACTION_EMOJI);
  }catch(_e){}
  await savePredictionSettings(message.guild.id,{
    reminder_role_id:role.id,
    reminder_panel_channel_id:panelMessage.channel.id,
    reminder_panel_message_id:panelMessage.id
  });
  return message.reply(`Posted the IPL DM reminder panel in ${targetChannel}. Users can react with ${REMINDER_REACTION_EMOJI} to get ${role}.`);
}
async function handlePredictCommand(message){
  const guildId=message.guild.id, settings=await getPredictionSettings(guildId);
  if(!settings?.channel_id)return message.reply("IPL prediction channel is not configured yet.");
  if(message.channel.id!==settings.channel_id)return message.reply(`Use \`?predict\` in <#${settings.channel_id}>.`);
  const db=getDB();
  const commandSlot=getPredictSlotFromCommand(message.content.trim().split(/\s+/)[0].replace(/^\?/,""));
  const {batch,match}=await resolveActiveMatchForSlot(guildId,commandSlot);
  if(!batch.length)return message.reply("There is no active announced IPL match right now.");
  if(!match){
    if(batch.length>1)return message.reply(`Two matches are active for **${batch[0].match_date_label}**.\nUse \`?predict1\` for **${batch[0].match_label}** and \`?predict2\` for **${batch[1].match_label}**.`);
    return message.reply("There is no active announced IPL match right now.");
  }
  const now=Math.floor(Date.now()/1000); if(now>=match.deadline_at)return message.reply(`Predictions are closed for **${match.match_label}**. Deadline was **${formatIst(match.deadline_at)}**.`);
  const existingEntry=await db.get("SELECT predicted_team FROM ipl_prediction_entries WHERE match_id = ? AND user_id = ?",match.id,message.author.id);
  const existingPanel=await db.get("SELECT prompt_message_id FROM ipl_prediction_panels WHERE match_id = ? AND user_id = ?",match.id,message.author.id);
  const embed=existingEntry?.predicted_team?buildPredictionSavedEmbed(match,normalizeTeamToken(existingEntry.predicted_team)):buildPredictionPromptEmbed(match);
  const prompt=await message.reply({embeds:[embed],components:buildPredictionButtons(match)});
  await db.run(`INSERT INTO ipl_prediction_panels (match_id, user_id, prompt_message_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(match_id, user_id) DO UPDATE SET prompt_message_id = excluded.prompt_message_id, updated_at = excluded.updated_at`,match.id,message.author.id,prompt.id,now);
  if(existingPanel?.prompt_message_id&&existingPanel.prompt_message_id!==prompt.id){
    const oldPrompt=await message.channel.messages.fetch(existingPanel.prompt_message_id).catch(()=>null);
    if(oldPrompt)await oldPrompt.edit({components:[]}).catch(()=>null);
  }
  return prompt;
}
async function handleTop4Command(message,args){
  const guildId=message.guild.id, settings=await getPredictionSettings(guildId);
  if(!settings?.channel_id)return message.reply("IPL prediction channel is not configured yet.");
  if(message.channel.id!==settings.channel_id)return message.reply(`Use \`?predicttop4\` in <#${settings.channel_id}>.`);
  const now=Math.floor(Date.now()/1000); if(now>=TOP4_DEADLINE_AT)return message.reply(`Top 4 predictions closed on **${formatIst(TOP4_DEADLINE_AT)}**.`);
  const parsed=parseTop4Teams(args); if(!parsed.ok)return message.reply(`${parsed.message}\nDeadline: **${formatIst(TOP4_DEADLINE_AT)}**`);
  const validTeams=getValidTeamsFromFixtures(readIplFixtures()), invalid=parsed.teams.find(t=>!validTeams.has(t));
  if(invalid)return message.reply(`Unknown IPL team code: **${invalid}**.`);
  await getDB().run(`INSERT INTO ipl_top4_entries (guild_id, user_id, slot_1_team, slot_2_team, slot_3_team, slot_4_team, submitted_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(guild_id, user_id) DO UPDATE SET slot_1_team=excluded.slot_1_team, slot_2_team=excluded.slot_2_team, slot_3_team=excluded.slot_3_team, slot_4_team=excluded.slot_4_team, submitted_at=excluded.submitted_at`,guildId,message.author.id,parsed.teams[0],parsed.teams[1],parsed.teams[2],parsed.teams[3],now);
  return message.reply({embeds:[new EmbedBuilder().setColor(0x0f766e).setTitle("Top 4 Prediction Saved").setDescription(formatTop4List(parsed.teams)).addFields({name:"Deadline",value:formatIst(TOP4_DEADLINE_AT),inline:true},{name:"Scoring",value:`**3/4 matched = ${TOP4_THREE_HIT_POINTS}** | **4/4 matched = ${TOP4_FULL_HIT_POINTS}** | **0-2 = 0**`,inline:false}).setFooter({text:"Order does not matter. You can change this before the deadline."})]});
}
async function handleMatchStatusCommand(message){
  const batch=await getActivePredictionBatch(message.guild.id); if(!batch.length)return message.reply("There is no active IPL prediction match right now.");
  const now=Math.floor(Date.now()/1000);
  const embed=new EmbedBuilder().setColor(0x2563eb).setTitle(`IPL Matches: ${batch[0].match_date_label}`).setDescription(batch.map((match,index)=>`**Match ${index+1}:** ${match.match_label}\nStatus: ${now>=match.deadline_at?"Closed":"Open"}\nDeadline: ${formatIst(match.deadline_at)}\nCommand: \`?predict${batch.length>1?index+1:""}\``).join("\n\n"));
  if(batch[0].announce_channel_id)embed.addFields({name:"Announced In",value:`<#${batch[0].announce_channel_id}>`});
  return message.reply({embeds:[embed]});
}
async function handlePredictionStatsCommand(message){
  const embed=await buildPredictionStatsEmbed(message.guild.id,message.author.id);
  const avatarUrl=message.member?.displayAvatarURL?.({extension:"png",size:256})||message.author?.displayAvatarURL?.({extension:"png",size:256})||null;
  if(avatarUrl)embed.setThumbnail(avatarUrl);
  return message.reply({embeds:[embed]});
}
async function handleMyPredictionsCommand(message){
  const db=getDB(), guildId=message.guild.id, userId=message.author.id;
  const leaderboardRows=await getCombinedLeaderboardRows(guildId,null);
  const userRank=leaderboardRows.findIndex(row=>row.userId===userId)+1;
  const rows=await db.all(`
    SELECT m.fixture_number, m.match_label, m.match_date_label, m.match_time_label, m.deadline_at, m.status, m.winner_team, e.predicted_team
    FROM ipl_prediction_entries e
    JOIN ipl_prediction_matches m ON m.id = e.match_id
    WHERE m.guild_id = ? AND e.user_id = ?
    ORDER BY m.starts_at DESC, m.id DESC
  `,guildId,userId);
  const top4Entry=await getTop4Entry(guildId,userId);
  const top4Result=await getTop4Result(guildId);
  if(!rows.length&&!top4Entry)return message.reply("You have not submitted any IPL predictions yet.");
  const avatarUrl=message.member?.displayAvatarURL?.({extension:"png",size:256})||message.author?.displayAvatarURL?.({extension:"png",size:256})||null;
  const wins=rows.filter(row=>row.status==="SETTLED"&&row.winner_team&&!isCancelledOutcome(row.winner_team)&&normalizeTeamToken(row.predicted_team)===normalizeTeamToken(row.winner_team));
  const losses=rows.filter(row=>row.status==="SETTLED"&&row.winner_team&&!isCancelledOutcome(row.winner_team)&&normalizeTeamToken(row.predicted_team)!==normalizeTeamToken(row.winner_team));
  const current=rows.filter(row=>row.status!=="SETTLED"||!row.winner_team);
  const cancelled=rows.filter(row=>row.status==="SETTLED"&&isCancelledOutcome(row.winner_team));
  let top4Points=0, top4Hits=0;
  if(top4Entry&&top4Result){
    const entryTeams=[top4Entry.slot_1_team,top4Entry.slot_2_team,top4Entry.slot_3_team,top4Entry.slot_4_team].map(normalizeTeamToken);
    const resultTeams=new Set([top4Result.slot_1_team,top4Result.slot_2_team,top4Result.slot_3_team,top4Result.slot_4_team].map(normalizeTeamToken));
    top4Hits=countTop4Hits(entryTeams,resultTeams);
    top4Points=calculateTop4Points(top4Hits);
  }
  const matchPointsGained=wins.length*MATCH_CORRECT_POINTS;
  const matchPointsLost=Math.abs(losses.length*MATCH_WRONG_POINTS);
  const netMatchPoints=matchPointsGained-matchPointsLost;
  const overallPoints=netMatchPoints+top4Points;
  const sectionMeta={
    summary:{label:"Summary",color:0x2563eb},
    wins:{label:"Wins",color:0x16a34a},
    losses:{label:"Losses",color:0xdc2626},
    current:{label:"Current",color:0xf59e0b}
  };
  const sectionChunks={
    wins:chunkArray(wins,5),
    losses:chunkArray(losses,5),
    current:chunkArray(current,5)
  };
  const pageState={wins:0,losses:0,current:0};
  let section="summary";
  const buildEmbed=()=>{
    const meta=sectionMeta[section];
    const embed=new EmbedBuilder().setColor(meta.color).setTitle(`My IPL Predictions: ${meta.label}`);
    if(section==="summary"){
      embed
        .setDescription("Your IPL prediction overview across settled and active picks.\nOverall Points = Match Points + Top 4 Points.")
        .addFields(
          {name:"Leaderboard Rank",value:userRank?`#${userRank}`:"Unranked",inline:true},
          {name:"Overall Points",value:String(overallPoints),inline:true},
          {name:"Match Points",value:String(netMatchPoints),inline:true},
          {name:"Wins",value:String(wins.length),inline:true},
          {name:"Losses",value:String(losses.length),inline:true},
          {name:"Current",value:String(current.length),inline:true},
          {name:"Cancelled",value:String(cancelled.length),inline:true},
          {name:"Match Points Gained",value:`+${matchPointsGained}`,inline:true},
          {name:"Match Points Lost",value:`-${matchPointsLost}`,inline:true},
          {name:"Top 4 Points",value:String(top4Points),inline:true},
          {name:"Top 4 Hits",value:`${top4Hits}/4`,inline:true},
          {name:`Your Top 4${top4Result?"":" (Pending)"}`,value:buildTop4Summary(top4Entry,top4Result)}
        );
    }else{
      const rowsForSection=sectionChunks[section];
      const currentPage=pageState[section];
      embed.setDescription(rowsForSection.length?rowsForSection[currentPage].map(formatPredictionHistoryLine).join("\n\n"):`No ${section} predictions yet.`);
      if(rowsForSection.length>1)embed.setFooter({text:`${meta.label} page ${currentPage+1}/${rowsForSection.length}`});
    }
    if(avatarUrl)embed.setThumbnail(avatarUrl);
    return embed;
  };
  const buildRows=()=>{
    const sectionRow=new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("iplmypred_section_select")
        .setPlaceholder("Select prediction view")
        .addOptions(
          {label:`Summary`,value:"summary",description:"Overview with overall points, match points, and Top 4",default:section==="summary"},
          {label:`Wins (${wins.length})`,value:"wins",description:"Correct settled predictions",default:section==="wins"},
          {label:`Losses (${losses.length})`,value:"losses",description:"Wrong settled predictions",default:section==="losses"},
          {label:`Current (${current.length})`,value:"current",description:"Active predictions waiting for results",default:section==="current"}
        )
    );
    const totalPages=section==="summary"?1:Math.max(sectionChunks[section].length,1);
    const currentPage=section==="summary"?0:pageState[section];
    const navRow=new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("iplmypred_prev").setLabel("Previous").setStyle(ButtonStyle.Secondary).setDisabled(section==="summary"||currentPage===0),
      new ButtonBuilder().setCustomId("iplmypred_next").setLabel("Next").setStyle(ButtonStyle.Primary).setDisabled(section==="summary"||currentPage>=totalPages-1)
    );
    return [sectionRow,navRow];
  };
  const response=await message.reply({embeds:[buildEmbed()],components:buildRows()});
  const collector=response.createMessageComponentCollector({
    filter:i=>i.user.id===message.author.id&&(
      i.customId==="iplmypred_prev"||
      i.customId==="iplmypred_next"||
      i.customId==="iplmypred_section_select"
    ),
    time:300000
  });
  collector.on("collect",async i=>{
    if(i.customId==="iplmypred_section_select")section=i.values?.[0]||section;
    if(i.customId==="iplmypred_prev"&&section!=="summary"&&pageState[section]>0)pageState[section]--;
    if(i.customId==="iplmypred_next"&&section!=="summary"&&pageState[section]<Math.max(sectionChunks[section].length,1)-1)pageState[section]++;
    await i.update({embeds:[buildEmbed()],components:buildRows()}).catch(()=>null);
  });
  collector.on("end",()=>{response.edit({components:[]}).catch(()=>null);});
}
async function handlePredictionStatsPreviewCommand(message){
  const member=message.mentions.members.first()||message.member;
  return message.reply({embeds:[await buildPredictionStatsPreviewEmbed(member)]});
}
async function handlePredictionLbPreviewCommand(message){
  return message.reply({embeds:[await buildPredictionLbPreviewEmbed(message.guild)]});
}

async function handleUserCommand(message,command,args){
  if(command===USER_COMMANDS.PREDICT||/^predict\d+$/i.test(command)){await handlePredictCommand(message); return true;}
  if(command===USER_COMMANDS.LEADERBOARD){await handleLeaderboardCommand(message); return true;}
  if(command===USER_COMMANDS.STATUS){await handleMatchStatusCommand(message); return true;}
  if(command===USER_COMMANDS.TOP4){await handleTop4Command(message,args); return true;}
  if(command===USER_COMMANDS.STATS){await handlePredictionStatsCommand(message); return true;}
  if(command===USER_COMMANDS.MY_PREDICTIONS){await handleMyPredictionsCommand(message); return true;}
  return false;
}
async function handleAdminCommand(message,command,args){
  if(command===ADMIN_COMMANDS.SET_CHANNEL){await handleSetChannelCommand(message); return true;}
  if(command===ADMIN_COMMANDS.SET_ANNOUNCE_CHANNEL){await handleSetAnnouncementChannelCommand(message); return true;}
  if(command===ADMIN_COMMANDS.SET_ANNOUNCE_ROLES){await handleSetAnnouncementPingRolesCommand(message); return true;}
  if(command===ADMIN_COMMANDS.ANNOUNCE){await handleAnnounceCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.REMINDER_PANEL){await handleReminderPanelCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.WINNER||/^iplwinner\d+$/i.test(command)){await handleWinnerCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.EDIT_WINNER){await handleEditWinnerCommand(message); return true;}
  if(command===ADMIN_COMMANDS.TOP4_RESULT){await handleTop4ResultCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.TOP4_PICKS){await handleTop4PicksCommand(message); return true;}
  if(command===ADMIN_COMMANDS.FIXTURES){await handleFixturesCommand(message); return true;}
  if(command===ADMIN_COMMANDS.MATCH_REPORT){await handleMatchReportCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.DAY_PICKS){await handleDayPicksCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.STATS_PREVIEW){await handlePredictionStatsPreviewCommand(message); return true;}
  if(command===ADMIN_COMMANDS.LB_PREVIEW){await handlePredictionLbPreviewCommand(message); return true;}
  if(command===ADMIN_COMMANDS.FLOW_PREVIEW){await handlePredictionFlowPreviewCommand(message,args); return true;}
  if(command===ADMIN_COMMANDS.GUIDE){await handleGuideCommand(message,args); return true;}
  return false;
}
async function handleInteraction(interaction){
  if(!interaction.isButton()||(!interaction.customId.startsWith("ipl_predict:")&&!interaction.customId.startsWith("ipl_settle:")))return false;
  const db=getDB(), parts=interaction.customId.split(":");
  if(parts.length!==3){await interaction.reply({content:"Invalid IPL action.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  const matchId=parseInt(parts[1],10);
  if(!Number.isInteger(matchId)){await interaction.reply({content:"Invalid IPL target.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  const match=await db.get("SELECT * FROM ipl_prediction_matches WHERE id = ? AND guild_id = ?",matchId,interaction.guildId);
  if(!match){await interaction.reply({content:"That IPL prediction match no longer exists.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  if(interaction.customId.startsWith("ipl_settle:")){
    if(!isAdmin(interaction.member)){await interaction.reply({content:"Only admins can settle IPL matches.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
    const now=Math.floor(Date.now()/1000);
    if(match.status==="SETTLED"){await interaction.reply({content:`This match has already been settled. Result: **${formatSettlementOutcome(match.winner_team)}**.`,flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
    if(now<match.deadline_at){await interaction.reply({content:`Predictions are still open for **${match.match_label}** until **${formatIst(match.deadline_at)}**.`,flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
    const outcome=normalizeSettlementOutcome(parts[2]);
    if(![normalizeTeamToken(match.team_a),normalizeTeamToken(match.team_b),MATCH_CANCELLED_OUTCOME].includes(outcome)){await interaction.reply({content:"Invalid settlement option.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
    const {updated,correct,wrong,total}=await settlePredictionMatch(interaction.guild,match,outcome,interaction.channelId);
    await interaction.update({embeds:[buildResultEmbed(updated,correct,wrong,total)],components:[]}).catch(()=>null);
    return true;
  }
  const now=Math.floor(Date.now()/1000), predictedTeam=normalizeTeamToken(parts[2]);
  if(match.status==="SETTLED"){await interaction.reply({content:`This match has already been settled. Result: **${formatSettlementOutcome(match.winner_team)}**.`,flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  if(now>=match.deadline_at){await interaction.reply({content:`Predictions are closed for **${match.match_label}**. Deadline was **${formatIst(match.deadline_at)}**.`,flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  const activePanel=await db.get("SELECT prompt_message_id FROM ipl_prediction_panels WHERE match_id = ? AND user_id = ?",match.id,interaction.user.id);
  if(!activePanel||activePanel.prompt_message_id!==interaction.message.id){await interaction.reply({content:"This prediction panel is outdated. Run the predict command again to get the latest one.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  if(![normalizeTeamToken(match.team_a),normalizeTeamToken(match.team_b)].includes(predictedTeam)){await interaction.reply({content:"That team is not part of this fixture.",flags:discord_js_1.MessageFlags.Ephemeral}).catch(()=>null); return true;}
  await db.run(`INSERT INTO ipl_prediction_entries (match_id, user_id, predicted_team, predicted_at) VALUES (?, ?, ?, ?) ON CONFLICT(match_id, user_id) DO UPDATE SET predicted_team = excluded.predicted_team, predicted_at = excluded.predicted_at`,match.id,interaction.user.id,predictedTeam,now);
  await interaction.update({embeds:[buildPredictionSavedEmbed(match,predictedTeam)],components:buildPredictionButtons(match)}).catch(()=>null);
  return true;
}
async function syncReminderReactionRole(reaction,user,shouldAdd){
  if(!reaction||!user||user.bot)return false;
  try{
    if(reaction.partial)reaction=await reaction.fetch();
    const message=reaction.message;
    if(!message?.guildId)return false;
    const settings=await getPredictionSettings(message.guildId);
    if(!settings?.reminder_panel_message_id||settings.reminder_panel_message_id!==message.id)return false;
    if(reaction.emoji?.name!==REMINDER_REACTION_EMOJI){
      if(shouldAdd)await reaction.users.remove(user.id).catch(()=>null);
      return true;
    }
    const guild=message.guild||await message.client.guilds.fetch(message.guildId).catch(()=>null);
    if(!guild)return false;
    const member=await guild.members.fetch(user.id).catch(()=>null);
    const role=settings.reminder_role_id?guild.roles.cache.get(settings.reminder_role_id)||await guild.roles.fetch(settings.reminder_role_id).catch(()=>null):null;
    if(!member||!role||!role.editable)return false;
    if(shouldAdd){
      if(!member.roles.cache.has(role.id))await member.roles.add(role,"IPL prediction reminder opt-in").catch(()=>null);
    }else{
      if(member.roles.cache.has(role.id))await member.roles.remove(role,"IPL prediction reminder opt-out").catch(()=>null);
    }
    return true;
  }catch(err){
    console.error("Failed to sync IPL reminder reaction role:",err);
    return false;
  }
}
async function handleReactionAdd(reaction,user){return syncReminderReactionRole(reaction,user,true);}
async function handleReactionRemove(reaction,user){return syncReminderReactionRole(reaction,user,false);}
async function processAutoAnnouncements(client){
  const db=getDB(), now=Math.floor(Date.now()/1000);
  const settingsRows=await db.all("SELECT * FROM ipl_prediction_settings WHERE channel_id IS NOT NULL AND announcement_channel_id IS NOT NULL");
  for(const settings of settingsRows){
    try{
      const openBatch=await getActivePredictionBatch(settings.guild_id);
      if(openBatch.length)continue;
      const fixtures=readIplFixtures();
      const nextFixture=fixtures.find(f=>f.deadlineAt>now);
      if(!nextFixture)continue;
      const duplicate=await db.get("SELECT id FROM ipl_prediction_matches WHERE guild_id = ? AND fixture_key = ?",settings.guild_id,nextFixture.fixtureKey);
      if(duplicate)continue;
      const guild=client.guilds.cache.get(settings.guild_id)||await client.guilds.fetch(settings.guild_id).catch(()=>null);
      if(!guild)continue;
      const predictionChannel=await guild.channels.fetch(settings.channel_id).catch(()=>null);
      const announcementChannel=await guild.channels.fetch(settings.announcement_channel_id).catch(()=>null);
      if(!predictionChannel?.isTextBased?.()||!announcementChannel?.isTextBased?.())continue;
      const batchFixtures=fixtures.filter(f=>f.dateLabel===nextFixture.dateLabel).sort((a,b)=>a.startsAt-b.startsAt||a.fixtureNumber-b.fixtureNumber);
      if(batchFixtures.some(f=>f.deadlineAt<=now))continue;
      const existingInBatch=await Promise.all(batchFixtures.map(f=>db.get("SELECT id FROM ipl_prediction_matches WHERE guild_id = ? AND fixture_key = ?",settings.guild_id,f.fixtureKey)));
      if(existingInBatch.some(Boolean))continue;
      const {createdMatches}=await announceFixtureBatch(guild,settings,batchFixtures,client.user?.id||"AUTO",announcementChannel,predictionChannel);
      await sendBatchReminderDms(guild,settings,createdMatches);
    }catch(err){
      console.error(`IPL auto announce failed for guild ${settings.guild_id}:`,err);
    }
  }
}

module.exports={ADMIN_COMMANDS,USER_COMMANDS,TOP4_DEADLINE_AT,handleAdminCommand,handleUserCommand,handleInteraction,handleReactionAdd,handleReactionRemove,processAutoAnnouncements,readIplFixtures};
