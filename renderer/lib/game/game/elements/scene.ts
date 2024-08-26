import {Constructable} from "../constructable";
import {Game} from "../game";
import {Awaitable, deepMerge, EventDispatcher, safeClone} from "@lib/util/data";
import {Background} from "../show";
import {ContentNode} from "../save/rollback";
import {LogicAction} from "@lib/game/game/logicAction";
import {SceneAction} from "@lib/game/game/actions";
import {Transform} from "@lib/game/game/elements/transform/transform";
import {ITransition} from "@lib/game/game/elements/transition/type";
import {SrcManager} from "@lib/game/game/elements/srcManager";
import {Sound, SoundDataRaw} from "@lib/game/game/elements/sound";
import Actions = LogicAction.Actions;
import _ from "lodash";

export type SceneConfig = {
    invertY?: boolean;
    invertX?: boolean;
    backgroundMusic?: Sound | null;
    backgroundMusicFade?: number;
} & Background;
export type SceneState = {
    backgroundMusic?: Sound | null;
};
export type JumpConfig = {
    transition: ITransition;
}

export type SceneDataRaw = {
    state: {
        backgroundMusic?: SoundDataRaw | null;
    };
}

export type SceneData = {};

// @todo: scene生命周期管理

export type SceneEventTypes = {
    "event:scene.setTransition": [ITransition | null];
    "event:scene.remove": [];
    "event:scene.applyTransition": [ITransition];
    "event:scene.load": [],
    "event:scene.unload": [],
    "event:scene.mount": [],
    "event:scene.unmount": [],
    "event:scene.preUnmount": [],
    "event:scene.imageLoaded": [],
    "event:scene.setBackgroundMusic": [Sound | null, number];
};

export class Scene extends Constructable<
    any,
    Actions,
    SceneAction<"scene:action">
> {
    static EventTypes: { [K in keyof SceneEventTypes]: K } = {
        "event:scene.setTransition": "event:scene.setTransition",
        "event:scene.remove": "event:scene.remove",
        "event:scene.applyTransition": "event:scene.applyTransition",
        "event:scene.load": "event:scene.load",
        "event:scene.unload": "event:scene.unload",
        "event:scene.mount": "event:scene.mount",
        "event:scene.unmount": "event:scene.unmount",
        "event:scene.preUnmount": "event:scene.preUnmount",
        "event:scene.imageLoaded": "event:scene.imageLoaded",
        "event:scene.setBackgroundMusic": "event:scene.setBackgroundMusic",
    }
    static defaultConfig: SceneConfig = {
        background: null,
        invertY: false,
        backgroundMusic: null,
        backgroundMusicFade: 0,
    };
    static defaultState: SceneState = {};
    static targetAction = SceneAction;
    readonly id: string;
    readonly name: string;
    readonly config: SceneConfig;
    state: SceneConfig & SceneState;
    srcManager: SrcManager = new SrcManager();
    events: EventDispatcher<SceneEventTypes> = new EventDispatcher();
    private _actions: SceneAction<any>[] = [];

    constructor(name: string, config: SceneConfig = Scene.defaultConfig) {
        super();
        this.id = Game.getIdManager().getStringId();
        this.name = name;
        this.config = deepMerge<SceneConfig>(Scene.defaultConfig, config);
        this.state = deepMerge<SceneConfig & SceneState>(Scene.defaultState, this.config);
    }

    static backgroundToSrc(background: Background["background"]) {
        return Transform.isStaticImageData(background) ? background.src : (
            background["url"] || null
        );
    }

    public activate(): this {
        return this.init();
    }

    public deactivate(): this {
        return this._exit();
    }

    public setSceneBackground(background: Background["background"]) {
        this._actions.push(new SceneAction(
            this,
            "scene:setBackground",
            new ContentNode<[Background["background"]]>(
                Game.getIdManager().getStringId(),
            ).setContent([
                background,
            ])
        ));
        return this;
    }

    /**
     * 跳转到指定的场景
     * 调用方法后，将无法回到当前调用该跳转的场景上下文，因此该场景会被卸载
     * 任何在跳转操作之后的操作都不会被执行
     */
    public jumpTo(actions: SceneAction<"scene:action">[] | SceneAction<"scene:action">, config?: JumpConfig): this;
    public jumpTo(scene: Scene, config?: JumpConfig): this;
    public jumpTo(arg0: SceneAction<"scene:action">[] | SceneAction<"scene:action"> | Scene, config?: JumpConfig): this {
        this._actions.push(new SceneAction(
            this,
            "scene:preUnmount",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent([])
        ));

        const jumpConfig: Partial<JumpConfig> = config || {};
        if (arg0 instanceof Scene) {
            const actions = arg0.getSceneActions();
            this._transitionToScene(arg0, jumpConfig.transition);
            return this._jumpTo(actions);
        }

        const actions = Array.isArray(arg0) ? arg0 : [arg0];
        const scene = actions[0]?.callee;
        if (scene) {
            this._transitionToScene(scene, jumpConfig.transition);
        }
        return this._jumpTo(actions);
    }

    public transitionSceneBackground(scene: Scene, transition: ITransition) {
        this._transitionToScene(scene, transition);
        return this;
    }

    /**
     * 等待一段时间，参数可以是毫秒数、Promise、或者一个未解析的{@link Awaitable}
     */
    public sleep(ms: number): this;
    public sleep(promise: Promise<any>): this;
    public sleep(awaitable: Awaitable<any, any>): this;
    public sleep(content: number | Promise<any> | Awaitable<any, any>): this {
        this._actions.push(new SceneAction(
            this,
            "scene:sleep",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent(content)
        ));
        return this;
    }

    /**
     * 设置背景音乐
     * @param sound 目标音乐
     * @param fade 毫秒数，如果设置，则会将渐出效果应用于上一首音乐，将渐入效果应用于当前音乐，时长为 {@link fade} 毫秒
     */
    public setBackgroundMusic(sound: Sound, fade?: number): this {
        this._actions.push(new SceneAction(
            this,
            "scene:setBackgroundMusic",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent([sound, fade])
        ));
        return this;
    }

    _setTransition(transition: ITransition) {
        this._actions.push(new SceneAction(
            this,
            "scene:setTransition",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent([transition])
        ));
        return this;
    }

    _applyTransition(transition: ITransition) {
        this._actions.push(new SceneAction(
            this,
            "scene:applyTransition",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent([transition])
        ));
        return this;
    }

    public applyTransition(transition: ITransition) {
        this._setTransition(transition)._applyTransition(transition);
        return this;
    }

    public toActions(): SceneAction<any>[] {
        let actions = this._actions;
        this._actions = [];
        return actions;
    }

    protected getSceneActions() {
        return this.toActions();
    }

    private _jumpTo(actions: SceneAction<"scene:action">[] | SceneAction<"scene:action">) {
        this._actions.push(new SceneAction(
            this,
            "scene:jumpTo",
            new ContentNode<[Actions[]]>(
                Game.getIdManager().getStringId(),
            ).setContent([
                Array.isArray(actions) ? actions.flat(2) : [actions]
            ])
        ));
        return this;
    }

    private _exit(): this {
        this._actions.push(new SceneAction(
            this,
            "scene:exit",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent([])
        ));
        return this;
    }

    private _transitionToScene(scene: Scene, transition?: ITransition): this {
        if (transition) {
            this._setTransition(transition)
                ._applyTransition(transition)
        }
        this._actions.push(
            ...scene.activate().toActions(),
        );
        this._exit()
        return this;
    }

    private init(): this {
        this._actions.push(new SceneAction(
            this,
            "scene:init",
            new ContentNode(
                Game.getIdManager().getStringId(),
            ).setContent([])
        ));
        return this;
    }

    $getBackgroundMusic() {
        return this.state.backgroundMusic;
    }

    toData() : SceneDataRaw {
        if (_.isEqual(this.state, this.config)) {
            return null;
        }
        return {
            state: {
                ...safeClone(this.state),
                backgroundMusic: this.state.backgroundMusic?.toData(),
            },
        }
    }

    fromData(data: SceneDataRaw): this {
        this.state = deepMerge<SceneConfig & SceneState>(this.state, data.state);
        if (data.state.backgroundMusic) {
            this.state.backgroundMusic = new Sound().fromData(data.state.backgroundMusic);
        }
        return this;
    }
}

