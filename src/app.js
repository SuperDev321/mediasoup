const express = require('express')

const app = express()
const https = require('httpolyglot')
const fs = require('fs')
const mediasoup = require('mediasoup')
const config = require('./config')
const path = require('path')
const Room = require('./Room')
const Peer = require('./Peer')
const cors = require('cors');
const options = {
    key: fs.readFileSync(path.join(__dirname, config.sslKey), 'utf-8'),
    cert: fs.readFileSync(path.join(__dirname, config.sslCrt), 'utf-8')
}

const httpsServer = https.createServer(options, app)
const io = require('socket.io')(httpsServer,{
    pingInterval: 60000,
    pingTimeout: 60000,
    upgradeTimeout: 30000,
    agent: false,
    reconnectionDelay: 1000,
    reconnectDelayMax: 5000,
    cors: {
        origin: "https://192.168.30.128:3000",
        allowedHeaders: ["my-custom-header"],
        credentials: true,
    }
})

app.use(express.static(path.join(__dirname, '..', 'public')))
app.use(cors());
httpsServer.listen(config.listenPort, () => {
    console.log('listening https ' + config.listenPort)
})



// all mediasoup workers
let workers = []
let nextMediasoupWorkerIdx = 0

/**
 * roomList
 * {
 *  room_id: Room {
 *      id:
 *      router:
 *      peers: {
 *          id:,
 *          name:,
 *          master: [boolean],
 *          transports: [Map],
 *          producers: [Map],
 *          consumers: [Map],
 *          rtpCapabilities:
 *      }
 *  }
 * }
 */
let roomList = new Map()

;
(async () => {
    await createWorkers()
})()

console.log(config.mediasoup.numWorkers)

async function createWorkers() {
    let {
        numWorkers
    } = config.mediasoup

    for (let i = 0; i < numWorkers; i++) {
        let worker = await mediasoup.createWorker({
            logLevel: config.mediasoup.worker.logLevel,
            logTags: config.mediasoup.worker.logTags,
            rtcMinPort: config.mediasoup.worker.rtcMinPort,
            rtcMaxPort: config.mediasoup.worker.rtcMaxPort,
        })

        worker.on('died', () => {
            console.error('mediasoup worker died, exiting in 2 seconds... [pid:%d]', worker.pid);
            setTimeout(() => process.exit(1), 2000);
        })
        workers.push(worker)

        // log worker resource usage
        /*setInterval(async () => {
            const usage = await worker.getResourceUsage();

            console.info('mediasoup Worker resource usage [pid:%d]: %o', worker.pid, usage);
        }, 120000);*/
    }
}

const createMediaRoom = async (room_id) => {
    if (roomList.has(room_id)) {
        return false;
    } else {
        let worker = await getMediasoupWorker()
        roomList.set(room_id, new Room(room_id, worker, io))
        return true;
    }
}

io.on('connection', socket => {
    socket.on('createMediaRoom', async ({
        room_id,
        token
    }, callback) => {
        if(token !== config.token) {
            return;
        }
        if (roomList.has(room_id)) {
            callback('already exists')
        } else {
            console.log('---created room--- ', room_id)
            let worker = await getMediasoupWorker()
            roomList.set(room_id, new Room(room_id, worker, io))
            callback(room_id)
        }
    })

    socket.on('hey', ({hey}) => {
        console.log('hey')
    })

    socket.on('joinMedia', async ({
        room_id,
        name,
        token
    }, cb) => {
        if(token !== config.token) {
            return cb(false);
        } 
        await createMediaRoom();
        if (!roomList.has(room_id)) {
            return cb({
                error: 'room does not exist'
            })
        }
        roomList.get(room_id).addPeer(new Peer(socket.id, name, room_id, io))
        socket.join(room_id);
        // cb(roomList.get(room_id).toJson())
        cb(true);
    })

    socket.on('getProducers', (room_id) => {
        console.log(`---get producers--- name:${roomList.get(room_id).getPeers().get(socket.id).name}`)
        // send all the current producer to newly joined member
        if (!roomList.has(room_id)) return
        let producerList = roomList.get(room_id).getProducerListForPeer(socket.id)

        socket.emit('newProducers', producerList)
    })

    socket.on('getRouterRtpCapabilities', (room_id, callback) => {
        try {
            console.log(`---get RouterRtpCapabilities--- name: ${roomList.get(room_id).getPeers().get(socket.id).name}`)
            callback(roomList.get(room_id).getRtpCapabilities());
        } catch (e) {
            callback({
                error: e.message
            })
        }

    });

    socket.on('createWebRtcTransport', async ({room_id}, callback) => {
        try {
            console.log(`---create webrtc transport--- name: ${roomList.get(room_id).getPeers().get(socket.id).name}`)
            const {
                params
            } = await roomList.get(room_id).createWebRtcTransport(socket.id);

            callback(params);
        } catch (err) {
            console.error(err);
            callback({
                error: err.message
            });
        }
    });

    socket.on('connectTransport', async ({
        transport_id,
        dtlsParameters,
        room_id
    }, callback) => {
        console.log(`---connect transport--- name: ${roomList.get(room_id).getPeers().get(socket.id).name}`)
        if (!roomList.has(room_id)) return
        await roomList.get(room_id).connectPeerTransport(socket.id, transport_id, dtlsParameters)
        
        callback('success')
    })

    socket.on('produce', async ({
        kind,
        rtpParameters,
        producerTransportId,
        room_id,
        name,
        locked
    }, callback) => {
        
        if(!roomList.has(room_id)) {
            return callback({error: 'not is a room'+room_id})
        }
    
        let producer_id = await roomList.get(room_id).produce(socket.id, producerTransportId, rtpParameters, kind, name, locked)
        console.log(`---produce--- type: ${kind} name: ${roomList.get(room_id).getPeers().get(socket.id).name} id: ${producer_id}`)
        callback({
            producer_id
        })
    })

    socket.on('consume', async ({
        consumerTransportId,
        producerId,
        rtpCapabilities,
        room_id
    }, callback) => {
        //TODO null handling
        let room = roomList.get(room_id);
        if(room) {
            let params = await roomList.get(room_id).consume(socket.id, consumerTransportId, producerId, rtpCapabilities)
            console.log(`---consuming--- name: ${roomList.get(room_id) && roomList.get(room_id).getPeers().get(socket.id).name} prod_id:${producerId} consumer_id:${params.id}`)
            callback(params)
        } else {
            callback(false);
        }
    })

    socket.on('resume', async (data, callback) => {
        await consumer.resume();
        callback();
    });

    socket.on('getMyRoomInfo', (room_id, cb) => {
        cb(roomList.get(room_id).toJson())
    })

    socket.on('disconnecting', () => {
        socket.rooms.forEach((room_id) => {
            let room = roomList.get(room_id)
            if(room) {
                room.removePeer(socket.id);
            }
        })
    })

    socket.on('producerClosed', ({
        producer_id,
        room_id
    }) => {
        console.log(`---producer close--- name: ${roomList.get(room_id) && roomList.get(room_id).getPeers().get(socket.id).name}`)
        roomList.get(room_id).closeProducer(socket.id, producer_id)
    })

    socket.on('roomProducersClosed', ({
        room_id
    }) => {
        if(roomList.has(room_id))
            roomList.get(room_id).closeAllProducers(socket.id);
    })

    socket.on('exitRoom', async (room_id, callback) => {
        console.log(`---exit room--- name: ${roomList.get(room_id) && roomList.get(room_id).getPeers().get(socket.id).name}`)
        if (!roomList.has(room_id)) {
            callback({
                error: 'not currently in a room'
            })
            return
        }
        // close transports
        await roomList.get(room_id).removePeer(socket.id)
        if (roomList.get(room_id).getPeers().size === 0) {
            roomList.delete(room_id)
        }

        // socket.room_id = null
        socket.leave(room_id);


        callback('successfully exited room')
    })

    socket.on('start view', async ({
        room_id, name, targetName
    }) => {
        let room = roomList.get(room_id);
        if(!room) {
            return callback(false, 'no media room');
        }
        const peer = room.getPeerByName(targetName);
        if (peer) {
            const socket_id = peer.id;
            socket.to(socket_id).emit('start view', {
                room_id,
                name
            });
        }
    });
    socket.on('stop view', async ({
        room_id, name, targetName
    }) => {
        let room = roomList.get(room_id);
        if(!room) {
            return callback(false, 'no media room');
        }
        const peer = room.getPeerByName(targetName);
        if (peer) {
            socket.to(peer.id).emit('stop view', {
                room_id,
                name
            })
        }
    });
    socket.on('view request', async ({
        roomName, username, targetId, targetName
    }, callback) => {
        let room = roomList.get(roomName);
        if(!room) {
            return callback(false, 'no media room');
        }
        console.log('target name', targetName)
        const peer = room.getPeerByName(targetName);
        if(!peer) {
            return callback(false, 'no peer');
        }
        if(peer.checkBlock(username)) {
            console.log('check block')
            return callback(false, 'blocked')
        }

        let targetSocket = io.of('/').sockets.get(peer.id);
    
        targetSocket.emit('view request', {
            roomName,
            username,
        }, (result) => {
            if(!result) {
                peer.addBlock(username);
            } else {
                peer.addAllow(username);
            }
            callback(result);
        });
    });
    socket.on('stop broadcast', ({
        room_id, name, targetName
    }, callback) => {
        let room = roomList.get(room_id);
        if(!room) {
            return callback(false, 'no media room');
        }
    
        let peers = Array.from(room.peers.values());
        let peer = peers.find((peer) => {
            if(peer.name === targetName) {
                return true;
            }
        })
        let socket_id = peer.id;
        socket.to(socket_id).emit('stop broadcast', {
            room_id,
            name
        })
    });

    socket.on('exit', async (_, callback) => {
        // if (!roomList.has(room_id)) {
        //     callback({
        //         error: 'not currently in a room'
        //     })
        //     return
        // }
        // close transports
        let rooms = socket.rooms;
        if(rooms && rooms.length) {
            rooms.forEach(async (room_id) => {
                if(roomList.has(room_id)) {
                    await roomList.get(room_id).removePeer(socket.id)
                    if (roomList.get(room_id).getPeers().size === 0) {
                        roomList.delete(room_id)
                    }
                    // socket.room_id = null
                    socket.leave(room_id);
                }
            })
            
        }
        callback('successfully exited room')
    })
})

function room() {
    return Object.values(roomList).map(r => {
        return {
            router: r.router.id,
            peers: Object.values(r.peers).map(p => {
                return {
                    name: p.name,
                }
            }),
            id: r.id
        }
    })
}

/**
 * Get next mediasoup Worker.
 */
function getMediasoupWorker() {
    const worker = workers[nextMediasoupWorkerIdx];

    if (++nextMediasoupWorkerIdx === workers.length)
        nextMediasoupWorkerIdx = 0;

    return worker;
}
