// Fetches model metadata from each creator listed in data/creators.yaml
// and writes the consolidated catalog to data/models.json.
//
// Run locally:   npm install && npm run fetch
// Or via the daily GitHub Action (.github/workflows/refresh.yml).

import { readFile, writeFile } from 'node:fs/promises';
import { parse as parseYAML } from 'yaml';
import * as cheerio from 'cheerio';

const ROOT = new URL('..', import.meta.url);
const CREATORS_FILE = new URL('data/creators.yaml', ROOT);
const OUT_FILE      = new URL('data/models.json', ROOT);

const UA = 'sculpture-portfolio/0.1 (+https://github.com/) - personal portfolio fetcher';

// ---------- Helpers ----------

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/, '') || 'untitled';
}

async function fetchText(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, 'Accept': '*/*', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.text();
}

async function fetchJSON(url, opts = {}) {
  const res = await fetch(url, {
    redirect: 'follow',
    headers: { 'User-Agent': UA, 'Accept': 'application/json', ...(opts.headers || {}) },
  });
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return await res.json();
}

// Keyword → tag rules. Order doesn't matter; all matches are applied.
// Matches use word boundaries so short keywords ("ken") don't match
// substrings inside longer words ("kennedy"). Keep this list curated, not
// exhaustive — false positives are worse than misses.
//
// Designed against the current catalog. When adding a new creator, scan
// their titles and either extend an existing tag or add a new one for a
// franchise with ~3+ items.
// Each model can carry multiple tags. Broad GENRE tags (anime, videogames,
// movies, cartoons, marvel, dc) + specific FRANCHISE tags (naruto, sekiro,
// resident-evil). A model gets both — "Kratos" → [videogames, god-of-war].
const KEYWORD_TAGS = [
  // ===================== BROAD GENRES =====================
  ['marvel', [
    'marvel','avengers','x-men','x men','spider-man','spider man','spiderman','spider-punk','miles morales',
    'iron man','iron patriot','hulkbuster','hulk','bruce banner','tony stark','steve rogers',
    'wolverine','wolv','magneto','captain america','thor','odin','black panther','killmonger',
    'rocket racoon','rocket raccoon','moon knight','deadpool','red hulk','jean grey','phoenix',
    'scarlet witch','storm','mystique','colossus','venom','punisher','kingpin','apocalypse',
    'loki','daredevil','professor x','cyclops','beast','nightcrawler','rogue','gambit',
    'doctor strange','dr strange','dr. strange','cable','domino','star lord','star-lord',
    'gamora','drax','groot','ant-man','ant man','vision','war machine','magik','lady deathstrike',
    'ghost rider','thanos','red guardian','red skull','juggernaut','witchblade','maestro','sentry',
    'blade','invincible','mark grayson',
    // VS3D additions
    'kraven the hunter','old man logan','symbiote','venomized hulk','venomized','red devil',
    'mary jane','mary jane tas','mj tas','goblin tas','venom tas','lizard-stas','lizard tas',
    'carnage','spiderman insomniac','spider-man insomniac','insomniac','andrew garfield','symbiote spider-man',
    'cavillrine','the cavillrine','deadpool and wolverine','kingpin tas','spider-man no way home',
    'no way home','daredevil red','daredevil black','red devil','the man in black','amazing web slinger',
    'eddys spiderman','abraham whistler','deacon frost','jared nomak','blade vs deacon','ghost rider vengeance',
    'punisher museum','the punisher','clayface tas','goblin spider',
  ]],
  ['dc', [
    'dc comics','batman','superman','wonder woman','aquaman','flash','green lantern',
    'green arrow','cyborg','joker','harley quinn','atrocitus','dr fate','dr. fate','shazam',
    'captain cold','killer frost','kingdom come','red son','raven','starfire','beast boy',
    'robin','nightwing','red hood','riddler','two face','two-face','penguin','darkseid',
    'lobo','the main man','catwoman','poison ivy','black mask','martian manhunter','static shock',
    'krypto','wondergirl','wonder girl','batgirl','batwoman','huntress','hawkgirl','artemis',
    'black manta','deathstroke','cheetah','sinestro','reverse flash','classic superman',
    'flashpoint','thomas wayne',
    // VS3D additions
    'manbat','killer croc','clayface','hugo strange','ra\'s al ghul','batman beyond','keaton batman',
    'kilmer','val kilmer','jared leto','batman 1989','batman returns','batman forever',
    'the batman 2022','the batman museum','bvs','bvs batman','bvs superman','old bruce','bane 1997',
    'mr. freeze','mr freeze','arkham','jim and barb','batsignal','eddys batman','eddys superman','eddys joker',
    'eddys aquaman','eddys green lantern','eddys wonder woman','eddys the flash','batman complete lineup',
    'jl line up','justice league line up','knight of steel','oswald cobblepot',
  ]],
  ['anime', [
    'jujutsu','sukuna','ryomen','gojo','itadori','maki','yuta','yuji','toji',
    'naruto','sasuke','itachi','jiraiya','madara','minato','kakashi','gaara','six paths of pain','maito gai',
    'dragon ball','goku','vegeta','gohan','majin','cell','frieza','broly','ssj2','beerus','piccolo',
    'one piece','luffy','zoro','sanji','nami','ace','law','doflamingo','mihawk','boa hancock','yamato','donquixote','vivi',
    'demon slayer','tanjiro','nezuko','giyu','kyojuro','akaza','muzan',
    'bleach','ichigo','ulquiorra','kenpachi','kon','vasto lorde',
    'my hero academia','dark deku','deku','bakugo','all might','todoroki',
    'hunter x hunter','hunterxhunter','killua','gon','hisoka','meruem','kurapika',
    'attack on titan','eren','mikasa','levi',
    'jojo','jotaro','dio brando',
    'berserk','guts','griffith','femto','beast of darkness',
    'ghost in the shell','motoko','kusanagi',
    'inuyasha','sesshomaru',
    'solo leveling','sung jinwoo','sung jin-woo','jin-woo','beru',
    'dandadan','momo ayase',
    'apothecary diaries','jinshi','maomao',
    'black clover','asta','yuno','noelle',
    'yu-gi-oh','yugioh','dark magician','kaiba','blue-eyes','exodia','pharaon',
    'vinland saga','thorfinn','askeladd',
    'hellsing','alucard',
    'spirited away','chihiro','kaonashi','howl','sophie','totoro','princess mononoke','studio ghibli',
    'frieren',
    'soul eater','lord death',
    'fairy tail','natsu','erza',
    'saint seiya','shiryu','pegasus seiya',
    'kaiju no.8','kaiju n.8','kaiju number 8',
    'fate/stay night','fate stay night','fate/grand order','rin tohsaka',
    'devilman','akira fudo',
    'cowboy bebop','spike spiegel',
    'full metal alchemist','fullmetal alchemist','edward elric','alphonse elric',
    'death note','light yagami','l lawliet','ryuk',
    'gachiakuta','rudo',
    'anime',
  ]],
  ['videogames', [
    'sekiro','isshin','ashina','kratos','god of war','atreus',
    'resident evil','leon kennedy','leon s. kennedy','jill valentine','nemesis','tyrant','chris redfield','ada wong',
    'gears of war','dominic santiago','marcus fenix',
    'mortal kombat','scorpion','sub-zero','sub zero','raiden','goro','liu kang','kitana','sonya blade','noob saibot',
    'mega man','crash bandicoot','super mario','mario bros','luigi','bowser','toad','yoshi','peach',
    'sonic the hedgehog','sonic','tails the fox','knuckles','dr robotnik',
    'lara croft','tomb raider','arthur morgan','red dead','grand theft auto','cj gta',
    'geralt','witcher','ciri','yennefer','triss',
    'dante','vergil','nero','devil may cry',
    'bayonetta','cuphead','mugman',
    'league of legends','twitch','jinx','vi','garen','overwatch','tracer','d.va','genji','reinhardt',
    'cyberpunk','johnny silverhand',
    'dark souls','bloodborne','elden ring','radahn','malenia',
    'samus','samus aran','metroid','zelda','link','ganondorf',
    'street fighter','chun-li','chun li','m. bison','ryu','ken masters',
    'portal bots','p-body','atlas','wheatley','glados',
    'final fantasy','chocobo','cloud strife','sephiroth','tifa','aerith','terra','kefka',
    'assassin\'s creed','assassins creed','ezio','altair',
    'metal gear','big boss','solid snake','snake','naked snake',
    'skyrim','dovahkiin','dragonborn','elder scrolls',
    'darksiders','horsemen',
    'kingdom hearts','sora kh',
    'metal slug','tarma','tarma roving',
    'hollow knight','silksong','hornet',
    'hades game','zagreus',
    'ori and the blind forest',
    'prince of persia',
    'it takes two',
    'flash gordon ship','flash gordon',
    'video game','videogame',
    // VS3D additions — videogame characters
    'arkham city','arkham origins','arkham asylum','arkham knight','hugo strange','clayface','killer croc',
    'manbat','ra\'s al ghul','ayame tenchu','tenchu','queen of pain','dota','dante\'s inferno','dantes inferno',
    'the evil within','evil within','inarius','diablo 4','diablo','ryu hayabusa','ninja gaiden','talion',
    'shadow of war','jericho cross','darkwatch','akira toriyama','agent 47','hitman agent','spider-man insomniac',
    'spiderman insomniac','insomniac','rdr2','sadie adler','dutch van der linde','tommy vercetti','vice city',
    'claude speed','carl johnson','trevor gtav','michael gtav','franklin gtav','gtav','gta v','gta iii','gta vice',
    'mother miranda','re village','re5','albert wesker','leon: resident','resident evil requiem','re requiem',
    'sweeney barber','king slayer','samson dota','kraven the hunter','mr. freeze','arkham',
  ]],
  ['movies', [
    'matrix','neo','trinity','jurassic','t-rex','alan grant','sinners','remmick',
    'john wick','terminator','predator','xenomorph','ripley','jack sparrow',
    'pirates of the caribbean','wall-e','wall e','iron giant','grinch','coraline','neytiri',
    'avatar pandora','hiccup','toothless','gandalf','balrog','lord of the rings','frodo','aragorn',
    'sauron','back to the future','marty mcfly','doc brown','ghostbusters','slimer',
    'stay puft','star trek','spock','indiana jones','rocky balboa','top gun','maverick movie',
    'transformers','megatron','optimus prime','bumblebee','starscream',
    'puss in boots','jack skellington','nightmare before christmas',
    // VS3D additions — film canon
    'goonies','tropic thunder','les grossman','tug speedman','alpa chino','kirk lazarus','jeff portnoy','kevin sandusky',
    '13 ghost','13 ghosts','13ghosts','the angry princess','the bound woman','the withered lover','the torn prince',
    'the great child','the broken heart','first born son','dire mother','the torso','jericho cross',
    'kill bill','pulp fiction','inglorious','inglourious','hook movie','hook diorama','jaws diorama','the orca',
    'crocodile dundee','willy wonka','tombstone diorama','last of the mohicans','highlander','braveheart','gladiator',
    'leonidas','the crow','forrest gump','sleepy hollow','headless horseman','sweeney todd','krampus',
    'violent night','santa-violent','face/off','007 daniel craig','phantom of the opera','jaws','men in black',
    'constantine','crocodile','big trouble in little china','jack burton','the patriot','boondock saints',
    'public enemis','public enemies','dillanger','dillinger','dracula untold','vlad the impaler','brightburn',
    'carrie','texas chainsaw','leatherface','elvis the68','elvis white jumpsuit','austin powers','ballerina',
    'tropic','starkiller','dany and drogon','dragon dany','dek: predator','predator badlands','wednesday addams',
    'madmartigan','willow','buddy the elf','sloth','chunk','mikey','mouth from the goonies','andy the goonies',
    'stef the goonies','brandon the goonies','data the goonies','old bruce','reflections','akira toriyama tribute',
    'point break','hacksaw ridge','scarface','zorro','kraven the hunter','batman 1989','batman returns',
    'batman forever','keaton batman','batman beyond','bvs','the batman 2022','the batman museum','jared leto',
    'penguin(devito)','val kilmer','kilmer','daemon targaryon','jon snow','spider-man no way home',
    'andrew garfield','symbiote','cavillrine','the cavillrine','old man logan','daredevil',
    'the punisher','venomized','venomized hulk','frankenstein','the wolfman','the mummy','bride of frankenstein',
    'eddie munson','goku vs frieza','dexter morgan diorama','peaky blinders','tommy shelby','arthur shelby',
    'john shelby','alfie solomons','polly gray','ragnar lothbrok','lagartha','lagertha','bray wyatt','the fiend',
    'pilgrimess','jack rackham','billy bones','black sails','anne bonny','eleanor guthrie','charles vane',
  ]],
  ['cartoons', [
    'snoopy','pink panther','mad hatter','johnny bravo','disney','rick and morty',
    'phineas and ferb','spongebob','woody woodpecker','asterix','obelix','looney tunes',
    'bugs bunny','daffy duck','coyote','road runner','scooby','shaggy','tom and jerry',
    'hank','sheila','venger','grinch','michelangelo','donatello','raphael','leonardo',
    'master splinter','tmnt','ninja turtles','lion o','skeletor','he-man','mr incredible',
    'mr. incredible','wall-e','wall e','iron giant','cinderella','stitch','buzz light',
    'mickey mouse','mike and sully','last ronin','taz','ed edd','double d','eddy',
    'courage the cowardly dog','rapunzel','uni the unicorn','chip and dale',
    'power ranger','power rangers','red ranger','green ranger','blue ranger','pink ranger',
    'invincible','mark grayson',
  ]],
  ['horror', [
    'jason','freddy krueger','michael myers','pennywise','ghostface','leatherface',
    'chucky','child\'s play','it the clown','the clown','demogorgon','stranger things',
    'jack torrance','the shining','pinhead','hellraiser','sadako','samara','annabelle',
    'sinners','remmick','john wick',
  ]],
  ['tv-shows', [
    'walter white','breaking bad','dexter morgan','dexter','arcane','rick and morty',
    'stranger things','game of thrones','invincible','the boys','mark grayson',
    // VS3D additions — TV / streaming
    'black sails','jack rackham','billy bones','anne bonny','eleanor guthrie','charles vane',
    'peaky blinders','tommy shelby','arthur shelby','john shelby','alfie solomons','polly gray',
    'vikings show','ragnar lothbrok','lagartha','lagertha','floki vikings',
    'wednesday addams','addams family','dany and drogon','jon snow got','daemon targaryon',
    'house of the dragon','game of thrones','ash vs evil','eddie munson','bray wyatt','the fiend',
    'wwe','wrestling','dexter morgan diorama',
  ]],
  ['celebrities', ['stan lee','michael jackson']],

  // ===================== FRANCHISE / TITLE TAGS =====================
  // Comic ecosystems
  ['x-men',           ['x-men','x men','wolverine','logan','magneto','professor x','mystique','jean grey','phoenix','cyclops','beast','nightcrawler','rogue','gambit','sabretooth','colossus','storm','juggernaut','lady deathstrike','magik']],
  ['avengers',        ['avengers','iron man','hulk','captain america','thor','black widow','hawkeye','scarlet witch','vision','war machine','endgame']],
  ['spider-verse',    ['spider-man','spider man','spider-punk','miles morales','peter parker']],
  ['the-boys',        ['homelander','soldier boy','butcher','starlight','black noir','a-train','the boys']],
  ['spawn',           ['spawn']],
  ['hellboy',         ['hellboy','right hand of doom']],
  ['tmnt',            ['tmnt','ninja turtles','donatello','raphael','michelangelo','leonardo','master splinter','last ronin','foot clan','shredder','krang']],
  ['masters-of-the-universe', ['he-man','skeletor','masters of the universe','motu','teela','beastman']],
  ['thundercats',     ['thundercats','lion o','lion-o','cheetara','mum-ra','mum ra','panthro','wilykat']],
  ['power-rangers',   ['power ranger','power rangers','red ranger','green ranger','blue ranger','pink ranger']],
  ['invincible',      ['invincible','mark grayson','omni-man','omni man']],
  ['witchblade',      ['witchblade']],
  ['transformers',    ['transformers','megatron','optimus prime','bumblebee','starscream']],
  ['darksiders',      ['darksiders','horsemen']],
  // Movies / cinematic
  ['star-wars',       ['mandalorian','grogu','star wars','jedi','sith','baby yoda','ahsoka','darth vader','darth maul','obi-wan','obi wan','luke skywalker','han solo','boba fett','yoda','samurai ahsoka']],
  ['lotr',            ['gandalf','balrog','lord of the rings','frodo','aragorn','sauron','gollum','legolas','gimli']],
  ['harry-potter',    ['harry potter','hogwarts','voldemort','dumbledore','snape','hermione','ron weasley']],
  ['pirates',         ['jack sparrow','pirates of the caribbean','davy jones']],
  ['matrix',          ['matrix','neo','trinity','morpheus','agent smith']],
  ['back-to-the-future', ['back to the future','marty mcfly','doc brown','delorean']],
  ['ghostbusters',    ['ghostbusters','slimer','stay puft']],
  ['avatar-movie',    ['neytiri','avatar pandora']],
  ['jurassic-park',   ['jurassic','t-rex','alan grant','velociraptor']],
  ['terminator',      ['terminator','t-800','t-1000','sarah connor']],
  ['alien-predator',  ['xenomorph','predator','ripley','aliens diorama','aliens sculpture','aliens bust']],
  ['pixar-disney',    ['mickey mouse','mr incredible','mr. incredible','mike and sully','sully','buzz light','cinderella','stitch','wall-e','wall e','iron giant','coraline','hiccup','toothless','rapunzel','chip and dale','puss in boots']],
  ['rocky',           ['rocky balboa','apollo creed','ivan drago']],
  ['indiana-jones',   ['indiana jones']],
  ['top-gun',         ['top gun','maverick movie']],
  ['studio-ghibli',   ['spirited away','chihiro','kaonashi','howl','sophie','totoro','princess mononoke','studio ghibli']],
  // Anime / manga franchises
  ['jujutsu-kaisen',  ['jujutsu kaisen','jujutsu','sukuna','ryomen','gojo','itadori','maki','yuta','yuji','toji']],
  ['naruto',          ['naruto','sasuke','itachi','jiraiya','madara','minato','kakashi','gaara','six paths of pain','maito gai']],
  ['dragon-ball',     ['dragon ball','goku','vegeta','gohan','majin','cell','frieza','broly','ssj2','beerus','piccolo']],
  ['one-piece',       ['one piece','luffy','zoro','sanji','nami','ace','law','doflamingo','mihawk','boa hancock','yamato','donquixote','shanks','red hair shanks']],
  ['demon-slayer',    ['demon slayer','tanjiro','nezuko','giyu','kyojuro','akaza','muzan']],
  ['bleach',          ['bleach','ichigo','ulquiorra','kenpachi','kon','vasto lorde']],
  ['my-hero-academia',['my hero academia','dark deku','deku','bakugo','all might','todoroki']],
  ['hunter-x-hunter', ['hunter x hunter','hunterxhunter','killua','gon','hisoka','meruem','kurapika']],
  ['attack-on-titan', ['attack on titan','eren','mikasa','levi']],
  ['jojo',            ['jojo','jotaro','dio brando']],
  ['berserk',         ['berserk','guts','griffith','femto','beast of darkness','behelit']],
  ['ghost-in-the-shell', ['ghost in the shell','motoko','kusanagi']],
  ['inuyasha',        ['inuyasha','sesshomaru']],
  ['solo-leveling',   ['solo leveling','sung jinwoo','sung jin-woo','jin-woo','beru']],
  ['dandadan',        ['dandadan','momo ayase']],
  ['apothecary-diaries', ['apothecary diaries','jinshi','maomao']],
  ['black-clover',    ['black clover','asta','yuno']],
  ['yugioh',          ['yu-gi-oh','yugioh','dark magician','kaiba','blue-eyes','exodia']],
  ['vinland-saga',    ['vinland saga','thorfinn','askeladd']],
  ['hellsing',        ['hellsing','alucard']],
  ['frieren',         ['frieren']],
  ['soul-eater',      ['soul eater','lord death']],
  ['fairy-tail',      ['fairy tail','natsu fairy','erza']],
  ['saint-seiya',     ['saint seiya','pegasus seiya','shiryu']],
  ['kaiju-no-8',      ['kaiju no.8','kaiju n.8','kaiju n8','kaiju number 8','soshiro hoshina']],
  ['fate-series',     ['fate/stay night','fate stay night','fate/grand order','rin tohsaka']],
  ['devilman',        ['devilman','akira fudo']],
  ['cowboy-bebop',    ['cowboy bebop','spike spiegel']],
  ['fullmetal-alchemist', ['full metal alchemist','fullmetal alchemist','edward elric','alphonse elric']],
  ['death-note',      ['death note','light yagami','l lawliet','ryuk']],
  ['one-punch-man',   ['one punch man','onepunch man','saitama','garou','puri-puri']],
  ['tokyo-ghoul',     ['tokyo ghoul','ken kaneki','kaneki','touka kirishima']],
  ['fire-force',      ['fire force','shinra kusakabe','benimaru shinmon']],
  ['dr-stone',        ['dr stone','dr. stone','senku ishigami']],
  ['trigun',          ['trigun','vash the stampede']],
  ['chainsaw-man',    ['chainsaw man','chainsawman','denji','pochita','makima','power x meowy','aki hayakawa','fox devil']],
  ['avatar-last-airbender', ['avatar: the last airbender','last airbender','aang','appa','momo aang','zuko','azula','korra']],
  ['evangelion',      ['neon genesis evangelion','rei ayanami','asuka langley','shinji ikari']],
  ['seven-deadly-sins', ['seven deadly sins','meliodas','elizabeth seven','escanor']],
  ['shangri-la',      ['shangri la frontier','shangri-la','sunraku']],
  ['sakamoto-days',   ['sakamoto days','sakamoto day','taro sakamoto','shin asakura']],
  ['spy-x-family',    ['spy x family','spyxfamily','loid forger','yor forger','anya forger','loid x yor']],
  ['shin-chan',       ['shin chan','shin-chan']],
  ['yuyu-hakusho',    ['yuyu hakusho','yu yu hakusho','hiei','kurama yuyu','yusuke']],
  // Videogame franchises
  ['sekiro',          ['sekiro','isshin','ashina','sekiro shadows die twice']],
  ['god-of-war',      ['god of war','kratos','atreus']],
  ['gears-of-war',    ['gears of war','dominic santiago','marcus fenix']],
  ['resident-evil',   ['resident evil','leon kennedy','leon s. kennedy','jill valentine','nemesis','tyrant','chris redfield','ada wong']],
  ['mortal-kombat',   ['mortal kombat','scorpion','sub-zero','sub zero','raiden','goro','liu kang','kitana','sonya blade','noob saibot']],
  ['street-fighter',  ['street fighter','chun-li','chun li','m. bison','ryu','ken masters']],
  ['mega-man',        ['mega man','megaman','megaman x']],
  ['crash-bandicoot', ['crash bandicoot']],
  ['super-mario',     ['super mario','mario bros','luigi','bowser','toad','yoshi','peach','princess daisy','daisy mario']],
  ['sonic',           ['sonic the hedgehog','sonic','tails the fox','knuckles','dr robotnik']],
  ['tomb-raider',     ['lara croft','tomb raider']],
  ['red-dead',        ['red dead','arthur morgan','john marston']],
  ['gta',             ['grand theft auto','gta','cj gta']],
  ['the-witcher',     ['witcher','geralt','ciri','yennefer','triss']],
  ['devil-may-cry',   ['devil may cry','dante','vergil','nero']],
  ['bayonetta',       ['bayonetta']],
  ['cuphead',         ['cuphead','mugman']],
  ['league-of-legends', ['league of legends','twitch','jinx','vi','garen','viego','nidalee','ashe','evelynn','yasuo','ahri','akali','zed']],
  ['overwatch',       ['overwatch','tracer','d.va','genji','reinhardt']],
  ['cyberpunk',       ['cyberpunk','johnny silverhand']],
  ['dark-souls',      ['dark souls']],
  ['bloodborne',      ['bloodborne']],
  ['elden-ring',      ['elden ring','radahn','malenia']],
  ['metroid',         ['metroid','samus aran','samus']],
  ['zelda',           ['legend of zelda','link','ganondorf','zelda']],
  ['final-fantasy',   ['final fantasy','chocobo','cloud strife','sephiroth','tifa','aerith','terra','kefka']],
  ['assassins-creed', ['assassin\'s creed','assassins creed','ezio','altair']],
  ['portal',          ['portal bots','p-body','atlas','wheatley','glados']],
  ['metal-gear',      ['metal gear','big boss','solid snake']],
  ['skyrim',          ['skyrim','dovahkiin','dragonborn','elder scrolls']],
  ['kingdom-hearts',  ['kingdom hearts','sora kh','riku kh']],
  ['metal-slug',      ['metal slug','tarma roving']],
  ['hollow-knight',   ['hollow knight','silksong','hornet']],
  ['hades',           ['hades game','zagreus']],
  ['ori',             ['ori and the blind forest']],
  ['prince-of-persia',['prince of persia']],
  ['it-takes-two',    ['it takes two']],
  ['pokemon',         ['pokemon','pokémon','mewtwo','wobbuffet','voltorb','pikachu','charizard','gen 10 starters']],
  ['halo',            ['halo','master chief','cortana']],
  ['star-fox',        ['star fox','fox mccloud','starfox']],
  ['nier',            ['nier','nier: automata','nier automata','2b - nier']],
  ['darkstalkers',    ['darkstalkers','morrigan']],
  ['guilty-gear',     ['guilty gear','bridget']],
  ['silent-hill',     ['silent hill','pyramid head']],
  ['fallout',         ['fallout','vault boy']],
  ['soul-reaver',     ['soul reaver','raziel']],
  ['warcraft',        ['warcraft','world of warcraft','illidan stormrage','illidan']],
  ['digimon',         ['digimon','agumon','gabumon','tai x agumon']],
  ['spyro',           ['spyro the dragon','spyro']],
  ['bomberman',       ['bomberman']],
  ['ben-10',          ['ben 10','grey matter ben 10','heatblast']],
  ['popeye',          ['popeye','bluto']],
  ['gargoyles',       ['gargoyles','goliath']],

  // ---------- VS3D-driven additions ----------
  // TV / streaming series
  ['black-sails',         ['black sails','jack rackham','billy bones','anne bonny','eleanor guthrie','charles vane','flint black sails']],
  ['peaky-blinders',      ['peaky blinders','tommy shelby','thomas shelby','arthur shelby','john shelby','alfie solomons','polly gray']],
  ['vikings-show',        ['vikings show','ragnar lothbrok','lagartha','lagertha','floki vikings']],
  ['game-of-thrones',     ['game of thrones','jon snow got','daemon targaryon','daemon targaryen','dany and drogon','house of the dragon','got diorama']],
  ['wednesday-addams',    ['wednesday addams','addams family']],
  ['ash-evil-dead',       ['ash vs evil dead','ashley williams','evil dead']],
  ['wwe-wrestling',       ['bray wyatt','the fiend','wwe','wrestling']],

  // Horror / monster cinema
  ['universal-monsters',  ['the mummy','the wolfman','frankenstein','bride of frankenstein','frankenstein\'s monster','dracula','phantom of the opera','the phantom of the opera','dracula armored','dracula untold','vlad the impaler','monsters diorama']],
  ['texas-chainsaw',      ['texas chainsaw','leatherface']],
  ['friday-the-13th',     ['friday the 13th','jason vorhees','jason voorhees']],
  ['nightmare-elm-street',['nightmare on elm street','freddy krueger']],
  ['hellraiser',          ['hellraiser','pinhead']],
  ['scream',              ['scream movie','ghostface']],
  ['13-ghosts',           ['13 ghost','13 ghosts','13ghosts','the angry princess','the bound woman','the withered lover','the torn prince','the great child','the broken heart','first born son','dire mother','the torso','jericho 13','juggernaut 13 ghost','13 ghost juggernaut','bold evil','bald evil']],
  ['carrie-movie',        ['carrie','carrie white']],
  ['brightburn',          ['brightburn']],
  ['krampus',             ['krampus','violent night','santa-violent','santa violent night']],
  ['sleepy-hollow',       ['sleepy hollow','headless horseman']],
  ['sweeney-todd',        ['sweeney todd']],

  // Adventure / drama / action films
  ['goonies',             ['goonies','sloth goonies','chunk goonies','mikey goonies','mouth from the goonies','andy the goonies','stef the goonies','brandon the goonies','data the goonies','sloth the goonies','chunk the goonies']],
  ['tropic-thunder',      ['tropic thunder','les grossman','tug speedman','alpa chino','kirk lazarus','jeff portnoy','kevin sandusky']],
  ['kill-bill',           ['kill bill','beatrix kiddo']],
  ['pulp-fiction',        ['pulp fiction','vincent vega','jules winnfield']],
  ['inglourious-basterds',['inglorious','inglourious','aldo raine']],
  ['gladiator-movie',     ['gladiator','maximus decimus']],
  ['braveheart',          ['braveheart','william wallace']],
  ['the-300',             ['leonidas','300 spartans']],
  ['highlander',          ['highlander']],
  ['james-bond',          ['james bond','007 daniel craig']],
  ['hook-movie',          ['hook movie','hook diorama','hook peter pan']],
  ['willow-movie',        ['willow movie','madmartigan']],
  ['willy-wonka',         ['willy wonka']],
  ['elf-movie',           ['buddy the elf','elf movie']],
  ['big-trouble-china',   ['big trouble in little china','jack burton']],
  ['v-for-vendetta',      ['v for vendetta']],
  ['constantine-movie',   ['constantine']],
  ['men-in-black',        ['men in black','mib diorama']],
  ['crocodile-dundee',    ['crocodile dundee']],
  ['forrest-gump',        ['forrest gump']],
  ['boondock-saints',     ['boondock saints']],
  ['face-off-movie',      ['face/off','sean archer','castor troy']],
  ['tombstone-movie',     ['tombstone diorama']],
  ['last-of-mohicans',    ['last of the mohicans']],
  ['point-break',         ['point break','bodhi','utah point break']],
  ['hacksaw-ridge',       ['hacksaw ridge']],
  ['public-enemies',      ['public enemis','public enemies','dillanger','dillinger']],
  ['the-patriot',         ['the patriot']],
  ['jaws-movie',          ['jaws diorama','jaws orca','the orca','jaws']],
  ['indiana-jones',       ['indiana jones','indy diorama']],
  ['pirates-caribbean',   ['pirates of the caribbean','jack sparrow','davy jones']],
  ['the-crow',            ['the crow','crow on the throne','crow gasoline']],
  ['scarface-movie',      ['scarface']],
  ['austin-powers',       ['austin powers']],
  ['elvis-tribute',       ['elvis the68','elvis white jumpsuit','elvis presley']],
  ['zorro',               ['zorro']],
  ['django-unchained',    ['django','django unchained']],
  ['scorpion-king',       ['scorpion king','the king of scorpions','king of scorpions']],
  ['day-of-the-jackal',   ['day of the jackal','the jackal']],
  ['rocky-films',         ['rocky','rocky balboa','apollo creed','ivan drago','creed']],

  // Batman live-action eras
  ['batman-1989-burton',  ['batman 1989','keaton batman','batman returns','joker 1989','penguin(devito)','penguin devito','catwoman returns']],
  ['batman-schumacher',   ['batman forever','batman and robin','val kilmer','kilmer','poison ivy(batman and robin)','two-face(batman forever)','riddler(batman forever)','robin(batman forever)','bane 1997','mr freeze schumacher']],
  ['dark-knight-trilogy', ['bank robber joker','tdk','dark knight','two-face(tdk)','the dark knight']],
  ['the-batman-2022',     ['the batman 2022','the batman 2022 film','catwoman zoe kravitz','riddler(the batman)','riddler the batman','penguin from the batman','oswald cobblepot','the batman museum','batman on batsignal','batman 2022']],
  ['bvs-dceu',            ['bvs','bvs batman','bvs superman','batman knight of steel','knight of steel','batman v superman']],
  ['the-flash-movie',     ['the flash movie','flash movie','flash solo(2023','supergirl(the flash movie','batman(the flash movie']],

  // Videogame franchises
  ['arkham-series',       ['arkham city','arkham origins','arkham asylum','arkham knight','hugo strange-arkham','arkham']],
  ['tenchu',              ['ayame tenchu','tenchu']],
  ['dota',                ['queen of pain','dota','samson dota']],
  ['dantes-inferno',      ['dante\'s inferno','dantes inferno']],
  ['the-evil-within',     ['the evil within','evil within','sebastian castellanos']],
  ['diablo',              ['inarius','diablo 4','diablo 3','diablo iv']],
  ['ninja-gaiden',        ['ryu hayabusa','ninja gaiden']],
  ['shadow-of-war',       ['talion','shadow of war','shadow of mordor']],
  ['darkwatch',           ['darkwatch','jericho cross']],
  ['hitman-games',        ['hitman agent 47','agent 47','hitman: codename']],
  ['gta-series',          ['grand theft auto','gta','cj gta','tommy vercetti','gta vice','vice city','claude speed','gta iii','gta 3','trevor gtav','michael gtav','franklin gtav','gtav','gta v']],
  ['rdr-series',          ['red dead','rdr2','arthur morgan','john marston','sadie adler','dutch van der linde']],
  ['resident-evil',       ['resident evil','leon kennedy','leon s. kennedy','jill valentine','nemesis','tyrant','chris redfield','ada wong','mother miranda','re village','re5','albert wesker','leon: resident','resident evil requiem','re requiem']],

  // 90s WB animated series (TAS = The Animated Series)
  ['90s-animated-series', ['tas','stas','tas batman','tas joker','tas robin','tas riddler','tas catwoman','tas manbat','tas two-face','tas mr. freeze','tas mr freeze','tas penguin','tas bane','tas killer croc','tas alfred','tas poison ivy','tas nightwing','tas ra\'s al ghul','tas spider-man','venom tas','goblin tas','lizard-stas','mary jane tas','mj tas','kingpin tas','clayface tas']],

  // ===================== FORM FACTOR =====================
  ['busts',           ['bust','portrait']],
  ['sculptures',      ['sculpture','statue']],
  ['dioramas',        ['diorama']],
  ['chibi',           ['chibi']],
  ['thrones',         ['throne']],
  ['book-holders',    ['book holder','bookholder','bookend','book ends']],
  ['weapons',         ['blaster','sword','hammer','gauntlet','axe','spear']],
];

const escapeRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const KEYWORD_RX = KEYWORD_TAGS.map(([tag, kws]) => [
  tag,
  new RegExp('\\b(?:' + kws.map(escapeRe).join('|') + ')\\b', 'i'),
]);

// When a model gets a franchise tag, also auto-apply the broad genre(s)
// for that franchise — so we don't have to duplicate every character name
// across both the franchise tag and the broad genre keyword list. Newer
// franchise tags lean on this; older ones still have duplicated keywords
// in the broad genre lists (harmless, just redundant).
const FRANCHISE_TO_GENRES = {
  // TV / streaming
  'black-sails':           ['tv-shows'],
  'peaky-blinders':        ['tv-shows'],
  'vikings-show':          ['tv-shows'],
  'game-of-thrones':       ['tv-shows'],
  'wednesday-addams':      ['tv-shows'],
  'ash-evil-dead':         ['tv-shows'],
  'wwe-wrestling':         ['tv-shows'],
  '90s-animated-series':   ['cartoons','tv-shows'],

  // Horror / monsters
  'universal-monsters':    ['movies','horror'],
  'texas-chainsaw':        ['movies','horror'],
  'friday-the-13th':       ['movies','horror'],
  'nightmare-elm-street':  ['movies','horror'],
  'hellraiser':            ['movies','horror'],
  'scream':                ['movies','horror'],
  '13-ghosts':             ['movies','horror'],
  'carrie-movie':          ['movies','horror'],
  'brightburn':            ['movies','horror'],
  'krampus':               ['movies','horror'],
  'sleepy-hollow':         ['movies','horror'],
  'sweeney-todd':          ['movies','horror'],

  // Adventure / drama films
  'goonies':               ['movies'],
  'tropic-thunder':        ['movies'],
  'kill-bill':             ['movies'],
  'pulp-fiction':          ['movies'],
  'inglourious-basterds':  ['movies'],
  'gladiator-movie':       ['movies'],
  'braveheart':            ['movies'],
  'the-300':               ['movies'],
  'highlander':            ['movies'],
  'james-bond':            ['movies'],
  'hook-movie':            ['movies'],
  'willow-movie':          ['movies'],
  'willy-wonka':           ['movies'],
  'elf-movie':             ['movies'],
  'big-trouble-china':     ['movies'],
  'v-for-vendetta':        ['movies'],
  'constantine-movie':     ['movies'],
  'men-in-black':          ['movies'],
  'crocodile-dundee':      ['movies'],
  'forrest-gump':          ['movies'],
  'boondock-saints':       ['movies'],
  'face-off-movie':        ['movies'],
  'tombstone-movie':       ['movies'],
  'last-of-mohicans':      ['movies'],
  'point-break':           ['movies'],
  'hacksaw-ridge':         ['movies'],
  'public-enemies':        ['movies'],
  'the-patriot':           ['movies'],
  'jaws-movie':            ['movies'],
  'indiana-jones':         ['movies'],
  'pirates-caribbean':     ['movies'],
  'the-crow':              ['movies'],
  'scarface-movie':        ['movies'],
  'austin-powers':         ['movies'],
  'elvis-tribute':         ['movies'],
  'zorro':                 ['movies'],
  'django-unchained':      ['movies'],
  'scorpion-king':         ['movies'],
  'day-of-the-jackal':     ['movies'],
  'rocky-films':           ['movies'],

  // Batman film eras
  'batman-1989-burton':    ['movies','dc'],
  'batman-schumacher':     ['movies','dc'],
  'dark-knight-trilogy':   ['movies','dc'],
  'the-batman-2022':       ['movies','dc'],
  'bvs-dceu':              ['movies','dc'],
  'the-flash-movie':       ['movies','dc'],

  // Videogame franchises
  'arkham-series':         ['videogames','dc'],
  'tenchu':                ['videogames'],
  'dota':                  ['videogames'],
  'dantes-inferno':        ['videogames'],
  'the-evil-within':       ['videogames'],
  'diablo':                ['videogames'],
  'ninja-gaiden':          ['videogames'],
  'shadow-of-war':         ['videogames'],
  'darkwatch':             ['videogames'],
  'hitman-games':          ['videogames'],
  'gta-series':            ['videogames'],
  'rdr-series':            ['videogames'],
  'resident-evil':         ['videogames'],
};

// Hard exclusions: titles matching any of these are dropped entirely.
// Covers life-size props, mass bundles, and oversized scale props.
const EXCLUDE_PATTERNS = [
  /\blife.?size(d)?\b/i,
  /\b(welcome|halloween|promo|swag|fathers?\s+day)\s+pack\b/i,
  /\ball\s+collection\b/i,
  /\bblack\s+friday\b/i,
  /collection:\s*weapons/i,
  /\b\d+:1\s+scale\b/i,
  // Patreon-style subscription tier listings (not models).
  /\b(standard|premium|gold|silver|bronze)\s+tier\b/i,
  /\bterm\b.*\btier\b/i,
  // VS3D-style "Month Rewards" / multi-model bundle listings (not individual models).
  /\b\d+\s+month\s+rewards?\b/i,
  /\b\d+\s+month\s+\d+\s+model\s+pack\b/i,
  /\blong\s+term\s+(models?|rewards?\s+models?)\s*\d*\b/i,
  /^\s*long\s+term\s+reward\s+models\b/i,
  /\bmodel\s+pack\b/i,
  // Meta listings from VS3D ("Dantes models(former artist)").
  /\bformer\s+artist\b/i,
];

// Standalone-prop detector: title has a weapon keyword but no sculpture
// marker. Narrow keyword list — excludes mask/helmet/shield on purpose
// because those frequently refer to characters ("The Mask", "Black Mask",
// "Captain America" with shield bust, etc).
const PROP_KEYWORDS = /\b(blaster|sword|hammer|axe|spear|gun|rifle|pistol|staff)\b/i;
const SCULPTURE_MARKERS = /\b(sculpture|sculptures|bust|portrait|figure|diorama|statue)\b/i;

function shouldExclude(title) {
  if (!title) return true;
  for (const rx of EXCLUDE_PATTERNS) if (rx.test(title)) return true;
  if (PROP_KEYWORDS.test(title) && !SCULPTURE_MARKERS.test(title)) return true;
  return false;
}

function inferTags(text) {
  const hay = text || '';
  const out = new Set();
  for (const [tag, rx] of KEYWORD_RX) {
    if (rx.test(hay)) out.add(tag);
  }
  // Backfill broad genres from franchise tags so every Goonies/Black Sails/
  // Arkham character gets movies/tv-shows/videogames respectively, without
  // having to duplicate the keyword in two places.
  for (const tag of [...out]) {
    const genres = FRANCHISE_TO_GENRES[tag];
    if (genres) for (const g of genres) out.add(g);
  }
  return [...out];
}

function makeModel({ creator, title, image, source_url, description, tags, extraTags }) {
  const id = `${slugify(creator)}--${slugify(title || source_url)}`;
  const auto = inferTags(`${title || ''} ${description || ''}`);
  return {
    id,
    slug: slugify(title || source_url),
    title: title || 'Untitled',
    creator,
    image,
    source_url,
    description: description || '',
    tags: [...new Set([...(tags || []), ...(extraTags || []), ...auto])].filter(Boolean),
    featured: false,
  };
}

// ---------- Adapters ----------

const adapters = {
  // MyMiniFactory public API. The user portion of the URL is the username.
  async myminifactory(creator) {
    const m = creator.url.match(/myminifactory\.com\/users\/([^/?#]+)/i);
    if (!m) throw new Error(`Can't parse MyMiniFactory username from ${creator.url}`);
    const username = m[1];
    const limit = creator.limit || 24;
    const api = `https://www.myminifactory.com/api/v2/users/${encodeURIComponent(username)}/objects?per_page=${limit}`;
    const data = await fetchJSON(api);
    const items = data.items || data.objects || data.data || [];
    return items.map(it => makeModel({
      creator: creator.name,
      title: it.name || it.title,
      image: it.images?.[0]?.thumbnail?.url || it.images?.[0]?.original?.url || it.preview_image,
      source_url: it.url || `https://www.myminifactory.com/object/${it.id}`,
      description: (it.short_description || '').slice(0, 280),
      tags: it.tags?.map(t => slugify(t.name || t)).slice(0, 4),
      extraTags: creator.tags,
    })).filter(m => m.image);
  },

  // Gumroad shop pages are Inertia.js apps. The HTML embeds the first page
  // of products per section in <div id="app" data-page=...>. To get the rest,
  // we hit /products/search?user_id={creator_external_id}&section_id={id}&from=N
  // which is the real endpoint Gumroad's React frontend uses.
  // Routes: app/controllers/links_controller.rb#search (antiwork/gumroad).
  async gumroad(creator) {
    const html = await fetchText(creator.url);
    const $ = cheerio.load(html);
    const raw = $('#app').attr('data-page');
    if (!raw) throw new Error('missing #app[data-page] (Gumroad page shape changed?)');
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { throw new Error(`could not parse Inertia payload: ${e.message}`); }

    const userExtId = data?.props?.creator_profile?.external_id;
    if (!userExtId) throw new Error('missing creator_profile.external_id');
    const sections = (data?.props?.sections || [])
      .filter(s => s?.type === 'SellerProfileProductsSection' && s?.id);

    const host = new URL(creator.url).host;
    const seen = new Set();
    const out = [];
    const PAGE = 50;
    const cap = creator.limit ?? Infinity; // full catalog by default; override via creators.yaml `limit:`

    const pushProduct = (p) => {
      if (!p?.permalink || seen.has(p.permalink)) return false;
      if (!p.thumbnail_url || !p.name) return false;
      seen.add(p.permalink);
      const fullUrl = (p.url || `https://${host}/l/${p.permalink}`).split('?')[0];
      out.push(makeModel({
        creator: creator.name,
        title: p.name,
        image: p.thumbnail_url,
        source_url: fullUrl,
        extraTags: creator.tags,
      }));
      return true;
    };

    for (const section of sections) {
      if (out.length >= cap) break;
      // Seed from the section payload already embedded in the HTML.
      for (const p of (section.search_results?.products || [])) {
        if (out.length >= cap) break;
        pushProduct(p);
      }
      // Paginate the rest via the search API.
      const total = section.search_results?.total ?? 0;
      let from = section.search_results?.products?.length ?? 0;
      while (from < total && out.length < cap) {
        const apiUrl = `https://gumroad.com/products/search?user_id=${encodeURIComponent(userExtId)}&section_id=${encodeURIComponent(section.id)}&from=${from}&size=${PAGE}`;
        let page;
        try {
          page = await fetchJSON(apiUrl);
        } catch (e) {
          // Don't kill the whole section on a single page failure — log and stop paginating this section.
          console.error(`    ! page from=${from} failed: ${e.message}`);
          break;
        }
        const pageProducts = page?.products || [];
        if (!pageProducts.length) break;
        let added = 0;
        for (const p of pageProducts) {
          if (out.length >= cap) break;
          if (pushProduct(p)) added++;
        }
        from += pageProducts.length;
        // Be polite — small delay between requests.
        await new Promise(r => setTimeout(r, 250));
        // Safety: if nothing new came back, stop to avoid an infinite loop.
        if (added === 0 && pageProducts.length < PAGE) break;
      }
    }
    return out;
  },

  // Payhip shop page.
  async payhip(creator) {
    const html = await fetchText(creator.url);
    const $ = cheerio.load(html);
    const out = [];
    $('a.product-card, a[href*="/b/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const url = href.startsWith('http') ? href : new URL(href, creator.url).toString();
      const img = $a.find('img').attr('src') || $a.find('img').attr('data-src');
      const title = $a.find('h3, .product-card__title').first().text().trim()
                 || $a.find('img').attr('alt');
      if (url && img && title) {
        out.push(makeModel({
          creator: creator.name,
          title, image: img, source_url: url,
          extraTags: creator.tags,
        }));
      }
    });
    return out.slice(0, creator.limit || 24);
  },

  // ArtStation has a public-ish projects JSON endpoint per user.
  async artstation(creator) {
    const m = creator.url.match(/artstation\.com\/([^/?#]+)/i);
    if (!m) throw new Error(`Can't parse ArtStation username from ${creator.url}`);
    const username = m[1];
    const limit = creator.limit || 24;
    const api = `https://www.artstation.com/users/${encodeURIComponent(username)}/projects.json?page=1`;
    const data = await fetchJSON(api, { headers: { 'Accept': 'application/json' } });
    const items = (data.data || []).slice(0, limit);
    return items.map(it => makeModel({
      creator: creator.name,
      title: it.title,
      image: it.cover?.thumb_url || it.cover?.medium_url || it.cover_url,
      source_url: it.permalink,
      description: '',
      extraTags: creator.tags,
    })).filter(m => m.image);
  },

  // Tribes creator page (best-effort scraper).
  async tribes(creator) {
    const html = await fetchText(creator.url);
    const $ = cheerio.load(html);
    const out = [];
    $('a[href*="/post/"], a[href*="/model/"]').each((_, el) => {
      const $a = $(el);
      const href = $a.attr('href') || '';
      const url = href.startsWith('http') ? href : new URL(href, creator.url).toString();
      const img = $a.find('img').attr('src') || $a.find('img').attr('data-src');
      const title = ($a.attr('title') || $a.find('img').attr('alt') || $a.text()).trim();
      if (url && img && title) {
        out.push(makeModel({
          creator: creator.name,
          title, image: img, source_url: url,
          extraTags: creator.tags,
        }));
      }
    });
    return out.slice(0, creator.limit || 24);
  },

  // Cults3D creator profile. Server-rendered HTML, paginated via ?page=N.
  // Each card is an <a class="tbox-thumb"> with a `title` attribute and a
  // nested <img data-src> (lazy-loaded). We walk pages until one returns
  // zero new items or we hit the safety cap.
  async cults(creator) {
    // Accept either a profile URL or a /modelos-3d URL; normalize to the
    // models listing.
    const u = new URL(creator.url);
    if (!/\/modelos-3d\/?$/.test(u.pathname)) {
      u.pathname = u.pathname.replace(/\/+$/, '') + '/modelos-3d';
    }
    u.search = '';
    const baseUrl = u.toString();
    const host = u.origin;
    const cap = creator.limit ?? Infinity;
    const MAX_PAGES = 30; // safety: 30 * 48 = 1440 items

    const seen = new Set();
    const out = [];

    for (let page = 1; page <= MAX_PAGES && out.length < cap; page++) {
      const pageUrl = page === 1 ? baseUrl : `${baseUrl}?page=${page}`;
      let html;
      try {
        html = await fetchText(pageUrl);
      } catch (e) {
        console.error(`    ! cults page ${page} failed: ${e.message}`);
        break;
      }
      const $ = cheerio.load(html);
      let addedThisPage = 0;
      $('a.tbox-thumb[href*="/modelo-3d/"]').each((_, el) => {
        if (out.length >= cap) return false;
        const $a = $(el);
        const href = $a.attr('href') || '';
        const url = href.startsWith('http') ? href : new URL(href, host).toString();
        if (seen.has(url)) return;
        const $img = $a.find('img').first();
        const image = $img.attr('data-src') || $img.attr('src');
        const title = ($a.attr('title') || $img.attr('alt') || '').trim();
        if (!url || !image || !title) return;
        seen.add(url);
        out.push(makeModel({
          creator: creator.name,
          title,
          image,
          source_url: url,
          extraTags: creator.tags,
        }));
        addedThisPage++;
      });
      if (addedThisPage === 0) break;
      // Be polite — small delay between page requests.
      await new Promise(r => setTimeout(r, 250));
    }
    return out;
  },

  // OpenGraph fallback. Treats the page itself as a single piece.
  // Useful for individual-product links you want to feature.
  async generic(creator) {
    const html = await fetchText(creator.url);
    const $ = cheerio.load(html);
    const og = name => $(`meta[property="og:${name}"]`).attr('content')
                    || $(`meta[name="og:${name}"]`).attr('content')
                    || $(`meta[name="twitter:${name}"]`).attr('content');
    const title = og('title') || $('title').first().text().trim();
    const image = og('image');
    const description = og('description') || '';
    if (!image) return [];
    return [makeModel({
      creator: creator.name,
      title, image,
      source_url: creator.url,
      description: description.slice(0, 280),
      extraTags: creator.tags,
    })];
  },
};

// ---------- Main ----------

function applyFeatured(models, featuredList) {
  if (!featuredList?.length) return;
  const wanted = new Set(featuredList.map(slugify));
  for (const m of models) {
    if (wanted.has(m.slug) || wanted.has(slugify(m.title))) m.featured = true;
  }
}

// Read the previous models.json (if any) so we can carry over the
// `first_seen` timestamp on models that already existed. Legacy models (in
// the catalog before this field existed) get a sentinel date well outside
// the 7-day "Nuevas" window — otherwise the first run after migration
// would flood that tab with everything in the catalog.
const LEGACY_SENTINEL = '2020-01-01T00:00:00.000Z';
async function loadPrevFirstSeen() {
  try {
    let txt = await readFile(OUT_FILE, 'utf8');
    if (txt.charCodeAt(0) === 0xFEFF) txt = txt.slice(1); // strip UTF-8 BOM
    const prev = JSON.parse(txt);
    const map = new Map();
    for (const m of (prev.models || [])) {
      map.set(m.id, m.first_seen || LEGACY_SENTINEL);
    }
    return map;
  } catch {
    return new Map();
  }
}

async function main() {
  const raw = await readFile(CREATORS_FILE, 'utf8');
  const cfg = parseYAML(raw) || {};
  const creators = cfg.creators || [];

  const prevFirstSeen = await loadPrevFirstSeen();
  const nowIso = new Date().toISOString();

  const allModels = [];
  const errors = [];

  for (const creator of creators) {
    const adapter = adapters[creator.platform];
    if (!adapter) {
      errors.push(`Unknown platform "${creator.platform}" for ${creator.name}`);
      continue;
    }
    if (creator.url.includes('EXAMPLE')) {
      console.log(`skip placeholder: ${creator.name}`);
      continue;
    }
    try {
      console.log(`fetch ${creator.platform}: ${creator.name}`);
      const items = await adapter(creator);
      applyFeatured(items, creator.featured);
      console.log(`  ↳ ${items.length} models`);
      allModels.push(...items);
    } catch (err) {
      const msg = `[${creator.name}] ${err.message}`;
      console.error('  !', msg);
      errors.push(msg);
    }
  }

  // De-dup by id
  const seen = new Map();
  for (const m of allModels) {
    if (!seen.has(m.id)) seen.set(m.id, m);
  }
  const deduped = [...seen.values()];

  // Drop lifesize props, bundles, and standalone weapons (no character sculpt).
  const kept = [];
  const dropped = [];
  for (const m of deduped) {
    if (shouldExclude(m.title)) dropped.push(m.title);
    else kept.push(m);
  }

  // Stamp `first_seen` on every model: carry over from previous run when the
  // id already existed; mint a fresh timestamp when it didn't. This powers
  // the "Nuevos esta semana" tab on the site.
  let newCount = 0;
  for (const m of kept) {
    const prev = prevFirstSeen.get(m.id);
    if (prev) {
      m.first_seen = prev;
    } else {
      m.first_seen = nowIso;
      newCount++;
    }
  }

  const out = {
    generated_at: nowIso,
    new_count: newCount,
    count: kept.length,
    excluded_count: dropped.length,
    errors,
    models: kept,
  };
  await writeFile(OUT_FILE, JSON.stringify(out, null, 2), 'utf8');
  console.log(`wrote ${kept.length} models → data/models.json (${dropped.length} excluded as bundles/props, ${newCount} new this run)`);
  if (errors.length) console.log(`(${errors.length} errors — see file)`);
}

main().catch(err => { console.error(err); process.exit(1); });
