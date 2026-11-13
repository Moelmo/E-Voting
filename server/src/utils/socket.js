let ioInstance = null;

export function setSocketIO(io) {
  ioInstance = io;
}

export function broadcastUpdate(event, data) {
  if (ioInstance) {
    ioInstance.emit(event, data);
  }
}
