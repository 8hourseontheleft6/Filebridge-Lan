/**
 * Filebridge-Lan - WebSocket 信令服务器
 * 
 * 中继WebRTC信令（Offer/Answer/ICE Candidate）
 * 不传输文件数据，仅用于建立P2P连接
 */

import { WebSocketServer, WebSocket } from 'ws';

const PORT = 42070;
const wss = new WebSocketServer({ port: PORT });

interface Room {
  host: WebSocket;
  client: WebSocket | null;
  hostId: string;
  clientId: string | null;
}

const rooms = new Map<string, Room>();

function generateRoomCode(): string {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

wss.on('connection', (ws: WebSocket) => {
  let roomId: string | null = null;
  let role: 'host' | 'client' | null = null;

  ws.on('message', (data: Buffer) => {
    try {
      const msg = JSON.parse(data.toString());

      switch (msg.type) {
        case 'create_room': {
          roomId = generateRoomCode();
          role = 'host';
          rooms.set(roomId, { host: ws, client: null, hostId: msg.deviceId, clientId: null });
          ws.send(JSON.stringify({ type: 'room_created', roomId }));
          console.log(`[房间] 创建: ${roomId} (${msg.deviceName})`);
          break;
        }

        case 'join_room': {
          const room = rooms.get(msg.roomId);
          if (!room) {
            ws.send(JSON.stringify({ type: 'error', message: '房间不存在' }));
            return;
          }
          if (room.client) {
            ws.send(JSON.stringify({ type: 'error', message: '房间已满' }));
            return;
          }
          roomId = msg.roomId;
          role = 'client';
          room.client = ws;
          room.clientId = msg.deviceId;
          // 通知host有客户端加入
          room.host.send(JSON.stringify({
            type: 'peer_joined',
            deviceId: msg.deviceId,
            deviceName: msg.deviceName,
          }));
          ws.send(JSON.stringify({ type: 'room_joined', roomId: msg.roomId }));
          console.log(`[房间] 加入: ${msg.roomId} (${msg.deviceName})`);
          break;
        }

        case 'offer': {
          const room = rooms.get(msg.roomId);
          if (room && room.client) {
            room.client.send(JSON.stringify({
              type: 'offer',
              sdp: msg.sdp,
              from: msg.deviceId,
            }));
          }
          break;
        }

        case 'answer': {
          const room = rooms.get(msg.roomId);
          if (room) {
            room.host.send(JSON.stringify({
              type: 'answer',
              sdp: msg.sdp,
              from: msg.deviceId,
            }));
          }
          break;
        }

        case 'ice_candidate': {
          const room = rooms.get(msg.roomId);
          if (room) {
            const target = role === 'host' ? room.client : room.host;
            if (target) {
              target.send(JSON.stringify({
                type: 'ice_candidate',
                candidate: msg.candidate,
                from: msg.deviceId,
              }));
            }
          }
          break;
        }
      }
    } catch (e) {
      console.error('[错误] 消息解析失败:', e);
    }
  });

  ws.on('close', () => {
    if (roomId && rooms.has(roomId)) {
      const room = rooms.get(roomId)!;
      if (role === 'host') {
        // Host断开，通知client
        if (room.client) {
          room.client.send(JSON.stringify({ type: 'host_disconnected' }));
        }
        rooms.delete(roomId);
        console.log(`[房间] 关闭: ${roomId}`);
      } else {
        // Client断开，通知host
        room.host.send(JSON.stringify({ type: 'peer_disconnected' }));
        room.client = null;
        room.clientId = null;
        console.log(`[房间] 客户端离开: ${roomId}`);
      }
    }
  });
});

console.log(`[Filebridge-Lan] 信令服务器启动于 ws://0.0.0.0:${PORT}`);
