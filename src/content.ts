import { SOCKET_EVENTS, SOCKET_URL } from "~types/socket"

import type { AppRouter } from "./background"
import { Storage } from "@plasmohq/storage"
import { VIDEO_EVENTS } from "~types/video"
import { chromeLink } from "trpc-chrome/link"
import { createTRPCProxyClient } from "@trpc/client"
import { io } from "socket.io-client"
import { parseRooms } from "~utils/rooms"

console.log("loaded cs")
const port = chrome.runtime.connect(chrome.runtime.id)

const chromeClient = createTRPCProxyClient<AppRouter>({
  links: [chromeLink({ port })]
})

let tabId: number
let roomCode: string | undefined
let video: HTMLVideoElement
const storage = new Storage({ area: "local" })
const socket = io(SOCKET_URL, { autoConnect: false })

export const init = async () => {
  tabId = await chromeClient.getTabId.query()
  console.log("tabId: ", tabId)
  const rooms: string | undefined = await storage.get("rooms")
  const r = parseRooms(rooms)
  roomCode = r?.[tabId]
  if (roomCode) {
    console.log("connecting")
    joinRoom()
    const videos = document.getElementsByTagName("video")
    video = videos[0]
    if (video) {
      console.log("Got video")
      Object.values(VIDEO_EVENTS).forEach((event) =>
        video.addEventListener(event, (e) => videoEventHandler(e))
      )
    }
  }
}

init()

const joinRoom = () => {
  console.log("Got room ", roomCode)
  if (socket.disconnected) socket.connect()
  console.log("Joining room ", roomCode)
  socket.emit(SOCKET_EVENTS.JOIN, roomCode)
}

socket.on(SOCKET_EVENTS.FULL, (room) => {
  // TODO: Handle full room
  console.log("Room " + room + " is full")
})

socket.on(SOCKET_EVENTS.JOIN, (room) => {
  console.log("Making request to join room " + room)
})

socket.on(SOCKET_EVENTS.LOG, (array) => {
  console.log(...array)
})

chrome.runtime.onMessage.addListener(function (request, _, sendResponse) {
  console.log("request: ", request)
  if (request.message === "init") {
    init()
    sendResponse({ status: "success", message: "ok" })
  } else if (request.message === "exit") {
    // TODO: Remove event listeners
    socket.disconnect()
    sendResponse({ status: "success", message: "ok" })
  } else if (request.message === "detectVideo") {
    const videos = document.getElementsByTagName("video")
    if (videos.length === 0)
      sendResponse({ status: "error", message: "No videos found" })
    else {
      video = videos[0]
      Object.values(VIDEO_EVENTS).forEach((event) =>
        video.addEventListener(event, (e) => videoEventHandler(e))
      )
      sendResponse({ status: "success", message: "ok" })
    }
  }
  return true
})

// To be used when automatic detection doesn't work
const handleVideoDetectManually = (ev: Event) => {
  const target = ev.target as Element
  video = target.closest("video") as HTMLVideoElement
  console.log(video)
  if (video != null) {
    document.removeEventListener("click", handleVideoDetectManually)
  }
}

const videoEventHandler = (event: Event) => {
  if (roomCode) {
    console.log(event)
    // consider throttle function if volumechange events impact performances
    socket.emit(
      SOCKET_EVENTS.VIDEO_EVENT,
      roomCode,
      event.type,
      video.volume,
      video.currentTime
    )
  }
}

socket.on(
  SOCKET_EVENTS.VIDEO_EVENT,
  (eventType: VIDEO_EVENTS, volumeValue: string, currentTime: string) => {
    const time = Number.parseInt(currentTime)
    switch (eventType) {
      case VIDEO_EVENTS.PLAY:
        video.play()
        break
      case VIDEO_EVENTS.PAUSE:
        video.pause()
        break
      case VIDEO_EVENTS.VOLUMECHANGE:
        video.volume = Number.parseFloat(volumeValue)
        break
      case VIDEO_EVENTS.SEEKED:
        // this check avoids entering in a loop between the two clients, a better solution could be found
        if (Math.abs(video.currentTime - time) > 1 && !video.seeking)
          video.currentTime = time
    }
  }
)

export {}
