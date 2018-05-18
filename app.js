const express = require('express');
const unique = require('node-uuid');
const SAT = require('sat');

let app = express();
let serv = require('http').Server(app);

app.get('/', function (req, res) {
    res.sendFile(__dirname + '/index.html');
});
app.use('/client', express.static(__dirname + '/client'));

serv.listen({
    host: '0.0.0.0',
    port: 2000,
    exclusive: true
});
console.log("Server started.");

//needed for physics update
// var startTime = (new Date).getTime();
// var lastTime;
// var timeStep = 1/70;

const MAX_ACCEL = 30;
const DRAG_CONST = 0.1;
const UPDATE_TIME = 0.06;
const ANGULAR_VEL = 0.5;
const DRAG_POWER = 1.5;

var counter = 0;

// create a new game instance
const game = {
    // List of players in the game
    player_list: {},
    /** @type Bullet[]*/
    bullets_list: [],
    // boxes object list
    boxes_list: [],
    // The max number of pickable boxes in the game
    boxes_max: 100,
    // Size of the boxes list
    boxes_len: 0,
    // Game height
    canvas_height: 4000,
    // Game width
    canvas_width: 4000
};

let lastBulletId = 0;

class Bullet {
    constructor(/** Number */ startX, /** Number */ startY, /** Number */ angle,
				/** Player ID */ creator, /** Number */ speed) {
        this.x = startX;
        this.y = startY;
        this.angle = angle;
		this.speed = speed;
        this.creator = creator;
        this.timeCreated = Date.now();
        this.id = ++lastBulletId;
    }
}

// Player class inside the server
class Player {
    constructor(startX, startY, startAngle, id, username) {
        this.id = id;
        this.username = username;
        this.x = startX;
        this.y = startY;
        this.angle = Math.PI / 2;
        this.speed = 0;
        this.accel = 0;
        this.ang_vel = 0;
        this.sendData = true;
        this.dead = false;
        this.bullets = 0;
		this.poly = new SAT.Polygon(new SAT.Vector(startX, startY), [
			new SAT.Vector(-32, -8),
			new SAT.Vector(-16, -15),
			new SAT.Vector(7, -15),
			new SAT.Vector(21, -11),
			new SAT.Vector(31, -3),
			new SAT.Vector(31, 2),
			new SAT.Vector(21, 10),
			new SAT.Vector(7, 14),
			new SAT.Vector(-16, 14),
			new SAT.Vector(-32, 7)
		]);
        this.inputs = {
            up: false,
            left: false,
            right: false,
            shootLeft: false,
            shootRight: false
        };
        this.lastShootTimeLeft = 0;
        this.lastShootTimeRight = 0;
        this.shootIntervalLeft = 1000; // ms
        this.shootIntervalRight = 1000; // ms
    }

    /**
     * Attempts to shoot a bullet in the provided direction taking into account the last time it
     * shoot in the same direction.
     * @param {Boolean}rightSide whether the ship is shooting from the right side
     * @returns {Bullet} The bullet just created, or null if can not shoot
     */
    tryToShoot(rightSide) {
        let canShoot = false; // TODO check ammo here
        if (rightSide) {
            if (this.lastShootTimeRight + this.shootIntervalRight < Date.now()) {
                canShoot = true;
                this.lastShootTimeRight = Date.now();
            }
        } else {
            if (this.lastShootTimeLeft + this.shootIntervalLeft < Date.now()) {
                canShoot = true;
                this.lastShootTimeLeft = Date.now();
            }
        }
        if (canShoot) {
            console.log('SHOOT');
            return new Bullet(this.x, this.y, this.angle + (rightSide ? 1 : -1) * Math.PI / 4,
							  this.id, 100);
        } else {
            return null;
        }
    }

	addAngle(angle) {
		this.angle += angle;
		this.poly.setAngle(this.angle-Math.PI/2);
	}

	addPos(x, y) {
		this.x += x;
		this.y += y;
		this.poly.pos.x = this.x;
		this.poly.pos.y = this.y;
	}
}

// Item class inside the server
class Item {
    constructor(max_x, max_y, type, id) {
        this.x = getRndInteger(100, max_x - 100);
        this.y = getRndInteger(100, max_y - 100);
        this.bullets = getRndInteger(1, 10);
		this.type = type;
		this.id = id;
		this.poly = new SAT.Polygon(new SAT.Vector(this.x, this.y), [
			new SAT.Vector(-8, -8),
			new SAT.Vector(-8, 8),
			new SAT.Vector(8, 8),
			new SAT.Vector(8, -8)
		]);
	}
}

// Returns a random integer between min and max
function getRndInteger(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

setInterval(updateGame, 1000 * UPDATE_TIME);

function updateGame() {
	for (let k in game.player_list) {
		if (!(k in game.player_list))
			continue;
		let p = game.player_list[k];
		p.accel = -Math.max(DRAG_CONST*Math.pow(p.speed, DRAG_POWER), 0);
		p.accel += (p.inputs.up)? MAX_ACCEL : 0;
		p.speed += p.accel*UPDATE_TIME;
		p.addPos(Math.sin(p.angle)*p.speed*UPDATE_TIME, -Math.cos(p.angle)*p.speed*UPDATE_TIME);
		let ratio = p.speed/Math.pow(MAX_ACCEL/DRAG_CONST, 1/DRAG_POWER);
		p.addAngle((p.inputs.right)? ratio*ANGULAR_VEL*UPDATE_TIME : 0);
		p.addAngle((p.inputs.left)? -ratio*ANGULAR_VEL*UPDATE_TIME : 0);

		/** @type Bullet */
        let newBullet = null;
        if (p.inputs.shootLeft) {
            newBullet = p.tryToShoot(false);
        }
        if (p.inputs.shootRight) {
            newBullet = p.tryToShoot(true);
        }
        if (newBullet) {
            game.bullets_list.push(newBullet);
			io.emit("bullet_update", newBullet)
        }
    }

    for (const bullet of game.bullets_list) {
        // TODO check bullet life and dissapear if too old

        // Move bullet
        bullet.x += Math.sin(bullet.angle) * bullet.speed * UPDATE_TIME;
        bullet.y -= Math.cos(bullet.angle) * bullet.speed * UPDATE_TIME;

        // TODO check collision with ships that are not the creator of the bullet
    }

	for (let k1 in game.player_list) {
		let p1 = game.player_list[k1];
		for (let k2 in game.player_list)
			collidePlayers(p1, game.player_list[k2]);
		for (let kb in game.boxes_list)
			collidePlayerAndBox(p1, game.boxes_list[kb]);
	}

	io.emit("update_game", {player_list: game.player_list, bullets_list: game.bullets_list});
}

// Create the pickable boxes there are missing at the game
function addBox() {
    let n = game.boxes_max - game.boxes_len;
    for (let i = 0; i < n; i++) {
        let unique_id = unique.v4(); // Creates a unique id
        let boxentity = new Item(game.canvas_width, game.canvas_height,
            'box', unique_id);
        game.boxes_list[unique_id] = boxentity;
        io.emit("item_update", boxentity); // MAYBE CHANGE THE FUNCTION DEPENDING OF WHAT I DO ON ITEM.JS
        game.boxes_len++;
    }
}

// Called after the player entered its name
function onEntername(data) {
    this.emit('join_game', {username: data.username, id: this.id});
}

// Called when a new player connects to the server
function onNewPlayer(data) {
    let newPlayer = new Player(data.x, data.y, data.angle, this.id,
        data.username);

    console.log("created new player with id " + this.id);

    console.log(newPlayer);

    this.emit('create_player', data);

    let current_info = {
        id: newPlayer.id,
        x: newPlayer.x,
        y: newPlayer.y,
        angle: newPlayer.angle,
    };

    for (let k in game.player_list) {
        existingPlayer = game.player_list[k];
        let player_info = {
            id: existingPlayer.id,
            username: existingPlayer.username,
            x: existingPlayer.x,
            y: existingPlayer.y,
            angle: existingPlayer.angle,
        };
        console.log("pushing player");
        this.emit("new_enemyPlayer", player_info);
    }

    for (let k in game.boxes_list)
        this.emit('item_update', game.boxes_list[k]);

    //send message to every connected client except the sender
    this.broadcast.emit('new_enemyPlayer', current_info);

    game.player_list[this.id] = newPlayer;
}

// Called when someone fired an input
function onInputFired(data) {
    let movePlayer = game.player_list[this.id];

    if (movePlayer === undefined || movePlayer.dead || !movePlayer.sendData)
        return;

    //every 20ms, we send the data.
    setTimeout(function () {
        movePlayer.sendData = true
    }, 60);
    //we set sendData to false when we send the data.
    movePlayer.sendData = false;

    movePlayer.inputs.up = data.up;
    movePlayer.inputs.left = data.left;
    movePlayer.inputs.right = data.right;
    movePlayer.inputs.shootLeft = data.shootLeft;
    movePlayer.inputs.shootRight = data.shootRight;
}

// Called when players collide
function collidePlayers (p1, p2) {
	if (!(p2.id in game.player_list) || !(p1.id in game.player_list)
		|| p1.id == p2.id || p1.dead || p2.dead)
		return;
	if (SAT.testPolygonPolygon(p1.poly, p2.poly)) {
		console.log(`${counter}: ${p1.username} collided with ${p2.username}`);
		counter++;
	}
}

// Called when an item is picked
function collidePlayerAndBox (p1, bx) {

	if (!(bx.id in game.boxes_list)) {
		console.log(data);
		console.log("could not find object");
		this.emit("itemremove", { id: data.id });
		return;
	}

	if (!(p1.id in game.player_list))
		return;

	if (SAT.testPolygonPolygon(p1.poly, bx.poly)) {
		p1.bullets += bx.bullets;

		delete game.boxes_list[bx.id];
		game.boxes_len--;
		console.log("item picked");

		io.emit('itemremove', bx);

		addBox();
	}
}

// Called when a someone dies
function playerKilled(player) {
    if (player.id in game.player_list)
        delete game.player_list[player.id];

    player.dead = true;
}

// Called when a client disconnects to tell the clients, except sender, to
// remove the disconnected player
function onClientDisconnect() {
    console.log('disconnect');
    if (this.id in game.player_list)

        delete game.player_list[this.id];

    console.log("removing player " + this.id);

    this.broadcast.emit('remove_player', {id: this.id});
}

// io connection
let io = require('socket.io')(serv,{});

io.sockets.on('connection', function(socket) {
	console.log("socket connected");
	socket.on('enter_name', onEntername);
	socket.on('logged_in', function(data){
		this.emit('enter_game', {username: data.username});
	});
	socket.on('disconnect', onClientDisconnect);
	socket.on("new_player", onNewPlayer);
	socket.on("input_fired", onInputFired);
});

// Prepare the boxes
addBox();
