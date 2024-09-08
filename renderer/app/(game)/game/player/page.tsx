"use client";

import {story} from "@/lib/game/story/scene1";
import Player from "@lib/ui/components/player/Player";
import {useGame} from "@/lib/ui/providers/game-state";

export default function Page() {
    const {game} = useGame();
    console.log(game)
    return (
        <div id={"__player_container"}>
            <Player story={story}/>
        </div>
    );
};