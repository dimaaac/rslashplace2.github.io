//server
import {WebSocketServer} from 'ws'
import {promises as fs} from 'fs'
import {createServer} from 'https'
import sha256 from 'sha256'
import fsExists from 'fs.promises.exists';
import fetch from 'node-fetch';
let SECURE = true
let BOARD, CHANGES
let {WIDTH, HEIGHT, PALETTE_SIZE, COOLDOWN} = JSON.parse(await fs.readFile('./config.json'))
try{
	BOARD = await fs.readFile('./place')
	CHANGES = await fs.readFile('./change').catch(e => new Uint8Array(WIDTH * HEIGHT).fill(255))
} catch(e) {
	BOARD = new Uint8Array(WIDTH * HEIGHT)
	CHANGES = await fs.readFile('./change').catch(e => new Uint8Array(WIDTH * HEIGHT).fill(255))
}
let newPos = [], newCols = []
let wss, cooldowns = new Map()

function runLengthChanges(){
	//compress CHANGES with run-length encoding
	let i = 0
	let bufs = [Buffer.alloc(256)], blast = 0, bi = 0
	bufs[0][bi++] = 2
	bufs[0].writeUint32BE(WIDTH, 1)
	bufs[0].writeUint32BE(HEIGHT, 5)
	bi += 8
	let add = a => {bufs[blast][bi++]=a;bi==256&&(bi=0,bufs.push(Buffer.alloc(256)),blast++)}
	while(true){
		let c = 0
		while(CHANGES[i] == 255)c++,i++
		if(i == CHANGES.length)break
		//c is # of blank cells
		//we will borrow 2 bits to store the blank cell count
		//00 = no gap
		//01 = 1-byte (Gaps up to 255)
		//10 = 2-byte	(Gaps up to 65535)
		//11 = 4-byte (idk probs never used)
		if(c < 256){
			if(!c)add(CHANGES[i++])
			else{
				add(CHANGES[i++] + 64)
				add(c)
			}
		}else if(c < 65536){
			add(CHANGES[i++] + 128)
			add(c >> 8)
			add(c)
		}else{
			add(CHANGES[i++] + 192)
			add(c >> 24)
			add(c >> 16)
			add(c >> 8)
			add(c)
		}
	}
	bufs[blast] = bufs[blast].slice(0,bi)
	return Buffer.concat(bufs)
}
const PORT = 443
if(SECURE){
	wss = new WebSocketServer({ perMessageDeflate: false, server: createServer({
	cert: await fs.readFile('../a.pem'), //etc/letsencrypt/live/server.rplace.tk/fullchain.pem'),
	key: await fs.readFile('../a.key'), //etc/letsencrypt/live/server.rplace.tk/privkey.pem'),
	perMessageDeflate: false }).listen(PORT) })
}else wss = new WebSocketServer({ port: PORT, perMessageDeflate: false })

let criticalFiles = ["blacklist.txt", "../vip.txt", "webhook_url.txt", "bansheets.txt", "./config.json"]
for (let i = 0; i < criticalFiles.length; i++) {
	if (!await fsExists(criticalFiles[i])) await fs.writeFile(criticalFiles[i], "", err => { if (err) { console.error(err); return; } });

}

let players = 0
let VIP
try{VIP = new Set((await fs.readFile('../vip.txt')).toString().split('\n'))}catch(e){}
const NO_PORT = a => a.split(':')[0].trim()
let BANS = new Set((await Promise.all(await fs.readFile('bansheets.txt').then(a=>a.toString().trim().split('\n').map(a=>fetch(a).then(a=>a.text()))))).flatMap(a=>a.trim().split('\n').map(NO_PORT)))
for(let ban of (await fs.readFile('blacklist.txt')).toString().split('\n'))BANS.add(ban)
let WEBHOOK_URL = (await fs.readFile("webhook_url.txt")).toString()

let hash = a => a.split("").reduce((a,b)=>(a*31+b.charCodeAt())>>>0,0)
let allowed = new Set("rplace.tk google.com wikipedia.org pxls.space".split(" ")), censor = a => a.replace(/fuc?k|shi[t]|c[u]nt/gi,a=>"*".repeat(a.length)).replace(/https?:\/\/(\w+\.)+\w{2,15}(\/\S*)?|(\w+\.)+\w{2,15}\/\S*|(\w+\.)+(tk|ga|gg|gq|cf|ml|fun|xxx|webcam|sexy?|tube|cam|p[o]rn|adult|com|net|org|online|ru|co|info|link)/gi, a => allowed.has(a.replace(/^https?:\/\//,"").split("/")[0]) ? a : "").trim()

wss.on('connection', async function(p, {headers, url: uri}) {
	p.ip = headers['x-forwarded-for'].split(',').pop().split(':',4).join(':')
	if(headers['origin'] != 'https://rplace.tk' || BANS.has(p.ip))return p.close()
	let url = uri.slice(1)
	let IP = /*p._socket.remoteAddress */url || p.ip
	if(url && !VIP.has(sha256(IP)))return p.close()
	let CD = url ? (IP.startsWith('!') ? 30 : COOLDOWN / 2) : COOLDOWN
	if(IP.startsWith("%")){BANS.add(p.ip);fs.appendFile("blacklist.txt","\n"+p.ip);return p.close()}
	if(!IP)return p.close()
	p.lchat = 0
	let buf = Buffer.alloc(9)
	buf[0] = 1
	buf.writeInt32BE(Math.ceil(cooldowns.get(IP) / 1000) || 1, 1)
	buf.writeInt32BE(COOLDOWN, 5)
	p.send(buf)
	players++
	p.send(runLengthChanges())
  p.on("error", _=>_)
  p.on('message', async function(data) {
		if(data[0] == 15){
			if(p.lchat + 2500 > NOW || data.length > 400)return
			p.lchat = NOW
			let txt = data.toString().slice(1), content, name, messageChannel
			[content, name, messageChannel] = txt.split("\n")
			let nlCount = 0
			if (!VIP.has(sha256(IP))) {
				for(var i=0; i < txt.length; i++) {
			    		if (txt[i] === "\n") nlCount++
				}
			}
			if (nlCount >= 4) return
			for(let c of wss.clients) {
                		c.send(data)
			}
			if(name) name = name.replace(/\W+/g,'').toLowerCase()
			if (!content) return
			try {
				let msgHook = { "username": `[${messageChannel}] ${name || "anon"} @rplace.tk`, "content": content }
				if (msgHook.content.includes("@") || msgHook.content.includes("http")) return
				await fetch(WEBHOOK_URL + "?wait=true", {"method":"POST", "headers": {"content-type": "application/json"}, "body": JSON.stringify(msgHook)})
			}
			catch(err) {
				console.log("Could not post to discord: " + err)
			}
			return;
		}else if(data[0] == 99 && CD == 30){
			let w = data[1], h = data[2], i = data.readUInt32BE(3)
			if(i%2000+w>=2000)return
			if(i+h*2000>=4000000)return
			let hi = 0
			while(hi < h){
				CHANGES.set(data.slice(hi*w+7,hi*w+w+7),i)
				i += 2000
				hi++
			}
		}
		if(data.length < 6)return //bad packet
		let i = data.readUInt32BE(1), c = data[5]
		if(i >= BOARD.length || c >= PALETTE_SIZE)return //bad packet
    		let cd = cooldowns.get(IP)
		if(cd > NOW){
			//reject
			let data = Buffer.alloc(10)
			data[0] = 7
			data.writeInt32BE(Math.ceil(cd / 1000) || 1, 1)
			data.writeInt32BE(i, 5)
			data[9] = CHANGES[i] == 255 ? BOARD[i] : CHANGES[i]
			p.send(data)
			return
		}
		//accept
		if(checkPreban(i%2000, Math.floor(i/2000), IP)) return p.close() 
		CHANGES[i] = c
		cooldowns.set(IP, NOW + CD - 500)
		newPos.push(i)
		newCols.push(c)
  })
	p.on('close', function(){ players-- })
})
let NOW = Date.now()
setInterval(() => {
	NOW = Date.now()
}, 50)

import { exec } from 'child_process'

let ORIGIN = (''+await fs.readFile("../.git-credentials")).trim()

async function pushImage(){
	for (let i = BOARD.length-1; i >= 0; i--)if(CHANGES[i]!=255)BOARD[i] = CHANGES[i]
	await fs.writeFile('place', BOARD)
	await new Promise((r, t) => exec("git add *;git commit -a -m 'Hourly backup';git push --force "+ORIGIN+"/rslashplace2/rslashplace2.github.io", e => e ? t(e) : r()))
	//serve old changes for 11 more mins just to be 100% safe
	let curr = new Uint8Array(CHANGES)
	setTimeout(() => {
		//after 11 minutes, remove all old changes. Where there is a new change, curr[i] != CHANGES[i] and so it will be kept, but otherwise, remove
		for(let i = curr.length - 1; i >= 0; i--)if(curr[i] == CHANGES[i])CHANGES[i] = 255
	}, 200e3)
}
setInterval(function(){
	if(!newPos.length)return
	let pos
	let buf = Buffer.alloc(1 + newPos.length * 5)
	buf[0] = 6
	let i = 1
	while((pos = newPos.pop()) != undefined){
		buf.writeInt32BE(pos, i)
		i += 4
		buf[i++] = newCols.pop()
	}
	for(let c of wss.clients){
		c.send(buf)
	}
}, 1000)

let I = 0

setInterval(async function(){
	I++
	await fs.writeFile('change', CHANGES)
	let buf = Buffer.of(3, players>>8, players)
	for (let c of wss.clients) {
		c.send(buf)
	}
	if(I % 720 == 0){
		try {
                	await pushImage()
                	console.log("["+new Date().toISOString()+"] Successfully saved r/place!")
        	} catch(e) {
                	console.log("["+new Date().toISOString()+"] Error pushing image")
        	}
        	for (let [k, t] of cooldowns) {
                	if(t > NOW)cooldowns.delete(k)
        	}
	}
}, 5000)

import repl from 'basic-repl'

let a, b, c, test
repl('$',(_)=>eval(_))
let O=()=>{console.log("\x1b[31mNothing to confirm!")}, yc = O;
Object.defineProperties(globalThis, {y: {get(){yc();yc=O}}, n: {get(){yc=O}}})
function fill(x, y, x1, y1, b = 27, random = false) {
	let w = x1-x, h = y1-y
	for(;y < y1; y++){
		for(;x < x1; x++){
			CHANGES[x + y * WIDTH] = random ? Math.floor(Math.random() * 24) :  b
		}
		x = x1 - w
	}
	return `Filled an area of ${w}*${h} (${(w*h)} pixels), reload the webpage to see the effects`
}

// This function is intended to allow us to ban any contributors to a heavily botted area (most likely botters) by banning them as soon as we notice them placing a pixel in such area. 
var prebanArea = { x: 0, y: 0, x1:0, y1:0, banPlaceAttempts:false }

function setPreban(_x, _y, _x1, _y1, ban = true) {
	prebanArea = { x: _x, y: _y, x1:_x1, y1:_y1, banPlaceAttempts:ban }
}
function clearPreban() {
	prebanArea = { x: 0, y: 0, x1:0, y1:0, banPlaceAttempts:false }
}

function checkPreban(incomingX, incomingY, ip) {
	if (prebanArea.x == 0 && prebanArea.y == 0 && prebanArea.x1 == 0 && prebanArea.y1 == 0) return false

	if ((incomingX > prebanArea.x && incomingX < prebanArea.x1) && (incomingY > prebanArea.y && incomingY < prebanArea.y1)) {
		if (prebanArea.banPlaceAttempts === true) {
			BANS.add(ip)
			fs.appendFile("blacklist.txt","\n"+ip)
		}
		console.log(`Pixel placed in preban area at ${incomingX},${incomingY} by ${ip}`)
		return true
	}
	else return false
}
