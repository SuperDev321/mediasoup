const express = require('express');
const config = require('./config');
const Room = require('./Room');
const Peer = require('./Peer');

const {
    roomList,
    createMediaRoom,
    getMediasoupWorker,
} = require('./media');
const router = express.Router();

router.post('/createMediaRoom', async (req, res) => {
    console.log('create media room', req.body)
    const {
        room_id,
        token
    } = req.body;
    if(token !== config.token) {
        return res
        .status(400)
        .json({});
    }
    if (roomList.has(room_id)) {
        res
        .status(200)
        .json({result: 'already exits'});
    } else {
        await createMediaRoom(room_id);
        // let worker = await getMediasoupWorker()
        // roomList.set(room_id, new Room(room_id, worker))
        res
        .status(200)
        .json({result: 'ok', data: room_id})
    }
})

router.post('/joinMedia', async (req, res) => {
    try {
        const {
            room_id,
            name,
            userId,
            token
        } = req.body;
        if(token !== config.token) {
            return res
            .status(400)
            .json({});
        } 
        // 
        if (!roomList.has(room_id)) {
            return res
            .status(400)
            .json({error: 'room does not exist'});
        }
        room = roomList.get(room_id);
        if (room && !room.peers.has(userId)) {
            room.addPeer(new Peer(userId, name, room_id, null))
        }
        res
        .status(200)
        .json({result: 'ok'})
    } catch (err) {
        console.log(err)
        return res
            .status(400)
            .json({error: err});
    }
})

    // socket.on('getProducers', (room_id) => {
    //     console.log(`---get producers--- name:${roomList.get(room_id).getPeers().get(socket.id).name}`)
    //     // send all the current producer to newly joined member
    //     if (!roomList.has(room_id)) return
    //     let producerList = roomList.get(room_id).getProducerListForPeer(socket.id)

    //     socket.emit('newProducers', producerList)
    // })

router.get('/getRouterRtpCapabilities/:room_id', (req, res) => {
    try {
        let { room_id } = req.params;
        // console.log(`---get RouterRtpCapabilities--- name: ${roomList.get(room_id).getPeers().get(socket.id).name}`)
        const room = roomList.get(room_id);
        const result = room.getRtpCapabilities();
        res
        .status(200)
        .json({
            data: result
        })
    } catch (e) {
        console.log(e.message)
        res
        .status(500)
        .json({})
    }

});

router.post('/createWebRtcTransport', async (req, res) => {
    const {room_id, userId, forceTcp, rtpCapabilities } = req.body
    try {
        console.log(`---create webrtc transport--- name: ${roomList.get(room_id).getPeers().get(userId).name}`)
        const {
            params
        } = await roomList.get(room_id).createWebRtcTransport(userId);
        res
        .status(200)
        .json({
            data: params
        });
    } catch (err) {
        res
        .status(400)
        .json({
            error: err.message
        })
    }
});

router.post('/connectTransport', async (req, res) => {
    try {
        const {
            transport_id,
            dtlsParameters,
            room_id,
            userId
        } = req.body;
        console.log(`---connect transport--- name: ${roomList.get(room_id).getPeers().get(userId)}`, userId)
        if (!roomList.has(room_id)) 
            return res
            .status(400)
            .json({
                error: 'not is a room' + room_id
            })
        await roomList.get(room_id).connectPeerTransport(userId, transport_id, dtlsParameters);
        res
        .status(200)
        .json({});
    } catch (err) {
        res
        .status(400)
        .json({
            error: err.message
        })
    }
});

router.post('/produce', async (req, res) => {
    try {
        const {
            kind,
            rtpParameters,
            producerTransportId,
            room_id,
            name,
            userId,
            locked
        } = req.body;
        if(!roomList.has(room_id)) {
            // return callback({error: 'not is a room'+room_id})
            return res
            .status(400)
            .json({
                error: 'not is a room' + room_id
            })
        }
        let producer_id = await roomList.get(room_id).produce(userId, producerTransportId, rtpParameters, kind, name, locked)
        console.log(`---produce--- type: ${kind} name: ${roomList.get(room_id).getPeers().get(userId).name} id: ${producer_id}`)
        res
        .status(200)
        .json({
            data: {
                producer_id
            }
        });
    } catch (err) {
        res
        .status(400)
        .json({
            error: err.message
        })
    }
})

router.post('/consume', async (req, res) => {
    const {
        consumerTransportId,
        producerId,
        rtpCapabilities,
        room_id,
        userId
    } = req.body;
    //TODO null handling
    let room = roomList.get(room_id);
    if(room) {
        let params = await roomList.get(room_id).consume(userId, consumerTransportId, producerId, rtpCapabilities)
        console.log(`---consuming--- name: ${roomList.get(room_id) && roomList.get(room_id).getPeers().get(userId).name} prod_id:${producerId} consumer_id:${params.id}`)
        res
        .status(200)
        .json({
            data: params
        });
    } else {
        return res
            .status(400)
            .json({
                error: 'not is a room' + room_id
            })
    }
})

    // socket.on('resume', async (data, callback) => {
    //     await consumer.resume();
    //     callback();
    // });

    // socket.on('getMyRoomInfo', (room_id, cb) => {
    //     cb(roomList.get(room_id).toJson())
    // })

    // socket.on('disconnecting', () => {
    //     socket.rooms.forEach((room_id) => {
    //         let room = roomList.get(room_id)
    //         if(room) {
    //             room.removePeer(socket.id);
    //         }
    //     })
    // })

router.post('/producerClosed', async (req, res) => {
    try {
        const {
            producer_id,
            room_id,
            userId
        } = req.body;
        roomList.get(room_id).closeProducer(userId, producer_id);
        return res
            .status(200)
            .json({})
    } catch (err) {
        return res
            .status(400)
            .json({error: err.message})
    }
})

router.post('/roomProducersClosed', async (req, res) => {
    try {
        const {
            room_id,
            userId
        } = req.body;
        if(roomList.has(room_id))
            roomList.get(room_id).closeAllProducers(userId);
        return res
            .status(200)
            .json({})
    } catch (err) {
        return res
            .status(400)
            .json({error: err.message})
    }
})

    // socket.on('roomProducersClosed', ({
    //     room_id
    // }) => {
    //     if(roomList.has(room_id))
    //         roomList.get(room_id).closeAllProducers(socket.id);
    // })

    // socket.on('pause producer', ({ room_id, kind, producerId }, fn) => {
    //     if(roomList.has(room_id)) {
    //         roomList.get(room_id).pauseProducer(socket.id, producerId);
    //     }
    //     fn(true)
    // })

    // socket.on('resume producer', ({ room_id, kind, producerId }, fn) => {
    //     if(roomList.has(room_id)) {
    //         roomList.get(room_id).resumeProducer(socket.id, producerId);
    //     }
    //     fn(true)
    // })

    // socket.on('exitRoom', async (room_id, callback) => {
    //     console.log(`---exit room--- name: ${roomList.get(room_id) && roomList.get(room_id).getPeers().get(socket.id).name}`)
    //     if (!roomList.has(room_id)) {
    //         callback({
    //             error: 'not currently in a room'
    //         })
    //         return
    //     }
    //     // close transports
    //     await roomList.get(room_id).removePeer(socket.id)
    //     if (roomList.get(room_id).getPeers().size === 0) {
    //         roomList.delete(room_id)
    //     }

    //     // socket.room_id = null
    //     socket.leave(room_id);


    //     callback('successfully exited room')
    // })

    // socket.on('start view', async ({
    //     room_id, name, targetName
    // }) => {
    //     let room = roomList.get(room_id);
    //     if(!room) {
    //         return callback(false, 'no media room');
    //     }
    //     const peer = room.getPeerByName(targetName);
    //     if (peer) {
    //         const socket_id = peer.id;
    //         socket.to(socket_id).emit('start view', {
    //             room_id,
    //             name
    //         });
    //     }
    // });
    // socket.on('stop view', async ({
    //     room_id, name, targetName
    // }, callback) => {
    //     let room = roomList.get(room_id);
    //     if(!room) {
    //         return callback(false, 'no media room');
    //     }
    //     const peer = room.getPeerByName(targetName);
    //     if (peer) {
    //         socket.to(peer.id).emit('stop view', {
    //             room_id,
    //             name
    //         })
    //     }
    // });
    // socket.on('view request', async ({
    //     roomName, username, targetId, targetName
    // }, callback) => {
    //     let room = roomList.get(roomName);
    //     if(!room) {
    //         return callback(false, 'no media room');
    //     }
    //     console.log('target name', targetName)
    //     const peer = room.getPeerByName(targetName);
    //     if(!peer) {
    //         return callback(false, 'no peer');
    //     }
    //     if(peer.checkBlock(username)) {
    //         console.log('check block')
    //         return callback(false, 'blocked')
    //     }

    //     let targetSocket = io.of('/').sockets.get(peer.id);
    
    //     targetSocket.emit('view request', {
    //         roomName,
    //         username,
    //     }, (result) => {
    //         if(!result) {
    //             peer.addBlock(username);
    //         } else {
    //             peer.addAllow(username);
    //         }
    //         callback(result);
    //     });
    // });
    // socket.on('stop broadcast', ({
    //     room_id, name, targetName
    // }, callback) => {
    //     let room = roomList.get(room_id);
    //     if(!room) {
    //         return callback(false, 'no media room');
    //     }
    
    //     let peers = Array.from(room.peers.values());
    //     let peer = peers.find((peer) => {
    //         if(peer.name === targetName) {
    //             return true;
    //         }
    //     })
    //     let socket_id = peer.id;
    //     socket.to(socket_id).emit('stop broadcast', {
    //         room_id,
    //         name
    //     })
    // });

    // socket.on('exit', async (_, callback) => {
    //     // if (!roomList.has(room_id)) {
    //     //     callback({
    //     //         error: 'not currently in a room'
    //     //     })
    //     //     return
    //     // }
    //     // close transports
    //     let rooms = socket.rooms;
    //     if(rooms && rooms.length) {
    //         rooms.forEach(async (room_id) => {
    //             if(roomList.has(room_id)) {
    //                 await roomList.get(room_id).removePeer(socket.id)
    //                 if (roomList.get(room_id).getPeers().size === 0) {
    //                     roomList.delete(room_id)
    //                 }
    //                 // socket.room_id = null
    //                 socket.leave(room_id);
    //             }
    //         })
            
    //     }
    //     callback('successfully exited room')
    // })

module.exports = router;