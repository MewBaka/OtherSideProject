import {
    Align,
    Background,
    color,
    CommonImage,
    CommonImagePosition,
    Coord2D,
    NextJSStaticImageData,
    Offset
} from "../../show";
import type {AnimationPlaybackControls, DOMKeyframesDefinition, DynamicAnimationOptions} from "framer-motion";
import {ImagePosition} from "../image";
import {deepMerge, DeepPartial, sleep, toHex} from "@lib/util/data";
import {GameState} from "@lib/ui/components/player/gameState";
import {TransformDefinitions} from "@lib/game/game/elements/transform/type";
import Sequence = TransformDefinitions.Sequence;
import SequenceProps = TransformDefinitions.SequenceProps;

export type Transformers =
    "position"
    | "opacity"
    | "scale"
    | "rotation"
    | "display"
    | "src"
    | "backgroundColor"
    | "backgroundOpacity";
export type TransformHandler<T> = (value: T) => DOMKeyframesDefinition;
export type TransformersMap = {
    "position": CommonImage["position"],
    "opacity": number,
    "scale": number,
    "rotation": number,
    "display": string,
    "src": string,
    "backgroundColor": Background["background"],
    "backgroundOpacity": number,
    "transform": TransformDefinitions.Types,
}

export class Transform<T extends TransformDefinitions.Types> {
    static defaultSequenceOptions: Partial<TransformDefinitions.CommonSequenceProps> = {
        sync: true,
        repeat: 1,
    };
    static defaultOptions: Partial<TransformDefinitions.CommonTransformProps> = {
        duration: 0,
        ease: "linear",
    }

    private readonly sequenceOptions: Partial<TransformDefinitions.CommonSequenceProps>;
    private sequences: TransformDefinitions.Sequence<T>[] = [];
    private control: AnimationPlaybackControls | null = null;
    private transformers: { [K in Transformers]?: Function } = {};

    /**
     * @example
     * ```ts
     * const transform = new Transform<ImageTransformProps>({
     *   opacity: 1,
     *   position: "center"
     * }, {
     *   duration: 0,
     *   ease: "linear"
     * });
     * ```
     */
    constructor(sequences: Sequence<T>[], sequenceOptions?: Partial<TransformDefinitions.TransformConfig>);
    constructor(props: DeepPartial<T>, options?: Partial<TransformDefinitions.CommonTransformProps>);
    constructor(arg0: Sequence<T>[] | DeepPartial<T>, arg1?: Partial<TransformDefinitions.CommonTransformProps> | TransformDefinitions.SequenceOptions) {
        if (Array.isArray(arg0)) {
            this.sequences.push(...arg0);
            this.sequenceOptions = Object.assign({}, Transform.defaultSequenceOptions, arg1 || {});
        } else {
            const [props, options] =
                [arg0, arg1 || Transform.defaultOptions];
            this.sequences.push({props, options: options || {}});
            this.sequenceOptions = Object.assign({}, Transform.defaultSequenceOptions);
        }
    }

    public static isAlign(align: any): align is Align {
        const {xalign, yalign, xoffset, yoffset} = align || {};
        const alignValid =
            (xalign === undefined || (xalign >= 0 && xalign <= 1))
            && (yalign === undefined || (yalign >= 0 && yalign <= 1));
        const offsetValid =
            (xoffset === undefined || typeof xoffset === "number")
            && (yoffset === undefined || typeof yoffset === "number");
        return alignValid && offsetValid;
    }

    public static isCommonImagePosition(position: any): position is CommonImagePosition {
        return Object.values(ImagePosition).includes(position);
    }

    public static isCoord2D(coord: any): coord is Coord2D {
        const coordRegex = /-?\d+%/;
        return (typeof coord.x === "number" || coordRegex.test(coord.x))
            && (typeof coord.y === "number" || coordRegex.test(coord.y));
    }

    public static isPosition(position: any): position is (CommonImagePosition | Coord2D | Align) {
        return this.isCommonImagePosition(position) || this.isCoord2D(position) || this.isAlign(position);
    }

    public static commonPositionToCoord2D(position: CommonImagePosition): Coord2D {
        const base: Coord2D = {x: "50%", y: "50%", xoffset: 0, yoffset: 0};
        switch (position) {
            case ImagePosition.left:
                return {...base, x: "0%"};
            case ImagePosition.center:
                return base;
            case ImagePosition.right:
                return {...base, x: "100%"};
        }
    }

    public static toCoord2D(position: Coord2D | Align | CommonImagePosition): Coord2D {
        if (this.isCommonImagePosition(position)) return this.commonPositionToCoord2D(position);
        if (this.isCoord2D(position)) return position;
        if (this.isAlign(position)) {
            const {xalign, yalign, ...rest} = position;
            return {
                x: xalign ? this.alignToCSS(xalign) : undefined,
                y: yalign ? this.alignToCSS(yalign) : undefined,
                ...rest
            };
        }
    }

    public static positionToCSS(
        position: CommonImage["position"],
        invertY?: boolean | undefined,
        invertX?: boolean | undefined
    ): { left?: string | number, right?: string | number, top?: string | number, bottom?: string | number } {
        const CommonImagePositionMap = {
            [ImagePosition.left]: "25.33%",
            [ImagePosition.center]: "50%",
            [ImagePosition.right]: "75.66%"
        }
        const x = this.offsetToCSS(
            Transform.isCommonImagePosition(position)
                ? (CommonImagePositionMap[position] || undefined)
                : Transform.isCoord2D(position)
                    ? this.coord2DToCSS(position.x)
                    : Transform.isAlign(position)
                        ? this.alignToCSS(position.xalign)
                        : undefined
            ,
            (!this.isCommonImagePosition(position) && position["xoffset"])
        );

        const y = this.offsetToCSS(
            Transform.isCommonImagePosition(position)
                ? "50%"
                : Transform.isCoord2D(position)
                    ? this.coord2DToCSS(position.y)
                    : Transform.isAlign(position)
                        ? this.alignToCSS(position.yalign)
                        : undefined,
            (!this.isCommonImagePosition(position) && position["yoffset"])
        );

        const yRes = invertY ? {bottom: y} : {top: y};
        const xRes = invertX ? {right: x} : {left: x};

        return {
            left: "auto",
            right: "auto",
            top: "auto",
            bottom: "auto",
            ...yRes,
            ...xRes
        };
    }

    public static offsetToCSS(origin: string | number, offset: Offset[keyof Offset] | undefined | false = 0): string | number {
        if (offset === false || !offset) return origin;
        return typeof origin === "number" ? origin + offset : `calc(${origin} + ${offset}px)`;
    }

    public static coord2DToCSS(coord: Coord2D[keyof Coord2D]): string {
        if (typeof coord === "number") return coord + "px";
        return coord;
    }

    public static alignToCSS(align: number): (
        `${number}%`
        ) {
        return `${align * 100}%`;
    }

    public static backgroundToCSS(background: Background["background"]): {
        backgroundImage?: string,
        backgroundColor?: string
    } {
        if (background === null || background === undefined) return {};
        if (this.isStaticImageData(background)) {
            return {backgroundImage: `url(${background.src})`};
        }
        const backgroundImage = background?.["url"] ? (
            "url(" + background?.["url"] + ")"
        ) : undefined;

        const backgroundColor = (!backgroundImage) ?
            background ? toHex(background as color) : undefined :
            undefined;
        return {backgroundImage, backgroundColor};
    }

    static isStaticImageData(src: any): src is NextJSStaticImageData {
        return src.src !== undefined;
    }

    static stateToCommonImageProps<T>(state: DeepPartial<T>): any {
        return {
            ...state,
            position: state["position"] ? Transform.toCoord2D(state["position"]) : undefined,
        }
    }

    static mergeState<T>(state: DeepPartial<T>, props: DeepPartial<T>): DeepPartial<T> {
        return deepMerge(Transform.stateToCommonImageProps<T>(state), Transform.stateToCommonImageProps<T>(props));
    }

    /**
     * @example
     * ```ts
     * const [scope, animate] = useAnimation();
     * transform.animate(scope, animate);
     * return <div ref={scope} />
     * ```
     */
    public async animate<U extends Element = any>(
        {scope, animate}:
            { scope: TransformDefinitions.FramerAnimationScope<U>, animate: TransformDefinitions.FramerAnimate },
        gameState: GameState,
        state: SequenceProps<T>,
        after?: (state: DeepPartial<T>) => void
    ) {
        console.debug("Animating", this); // @debug

        // unsafe
        state = deepMerge<DeepPartial<T>>(state, {});

        return new Promise<void>(async (resolve) => {
            if (!this.sequenceOptions.sync) {
                resolve();
                if (after) {
                    after(state);
                }
            }
            for (let i = 0; i < this.sequenceOptions.repeat; i++) {
                for (const {props, options} of this.sequences) {
                    const initState = deepMerge({}, this.propToCSS(gameState, state));

                    if (!scope.current) {
                        throw new Error("No scope found when animating.");
                    }
                    const current = scope.current as Element;
                    Object.assign(current["style"], initState);

                    state = Transform.mergeState(state, props);
                    const animation = animate(
                        current,
                        this.propToCSS(gameState, state),
                        this.optionsToFramerMotionOptions(options)
                    );
                    this.setControl(animation);

                    if (options?.sync !== false) {
                        await new Promise<void>(r => animation.then(() => r()));
                        Object.assign(current["style"], this.propToCSS(gameState, state));
                        this.setControl(null);
                    } else {
                        animation.then(() => {
                            Object.assign(current["style"], this.propToCSS(gameState, state));
                            this.setControl(null);
                        });
                    }
                }
            }

            // I don't understand
            // but if we don't wait for a while, something will go wrong
            await sleep(2);
            this.setControl(null);
            console.log("animation done")

            if (this.sequenceOptions.sync) {
                resolve();
                if (after) {
                    after(state);
                }
            }
        });
    }

    /**
     * 将动画的重复次数乘以n
     * 会受到传入Config的影响
     * @example
     * ```ts
     * transform
     *   .repeat(2)
     *   .repeat(3)
     * // 重复6次
     * ```
     */
    public repeat(n: number) {
        this.sequenceOptions.repeat *= n;
        return this;
    }

    /**
     * overwrite a transformer
     * @example
     * ```ts
     * transform.overwrite("position", (value) => {
     *   return {left: value.x, top: value.y};
     * });
     * ```
     */
    public overwrite<T extends keyof TransformersMap = any>(key: T, transformer: TransformHandler<TransformersMap[T]>) {
        this.transformers[key as any] = transformer;
        return this;
    }

    propToCSS(state: GameState, prop: DeepPartial<T>): DOMKeyframesDefinition {
        const {invertY, invertX} = state.getLastScene()?.config || {}
        const FieldHandlers: Record<string, (v: any) => any> = {
            "position": (value: CommonImage["position"]) => Transform.positionToCSS(value, invertY, invertX),
            "backgroundColor": (value: Background["background"]) => Transform.backgroundToCSS(value),
            "backgroundOpacity": (value: number) => ({opacity: value}),
            "opacity": (value: number) => ({opacity: value}),
            "scale": () => ({}),
            "rotation": () => ({}),
            "display": () => ({}),
            "src": () => ({}),
        };

        const props = {} as DOMKeyframesDefinition;
        props.transform = this.propToCSSTransform(state, prop);
        if (this.transformers["transform"]) {
            Object.assign(props, this.transformers["transform"](prop));
        }

        for (const key in prop) {
            if (!prop.hasOwnProperty(key)) continue;
            if (this.transformers[key as any]) {
                Object.assign(props, this.transformers[key as any](prop[key]));
            } else if (FieldHandlers[key]) {
                Object.assign(props, FieldHandlers[key](prop[key]));
            }
        }
        return props;
    }

    optionsToFramerMotionOptions(options?: Partial<TransformDefinitions.CommonTransformProps>): DynamicAnimationOptions {
        if (!options) {
            return options;
        }
        const {duration, ease} = options;
        return {
            duration: duration / 1000,
            ease,
        };
    }

    propToCSSTransform(state: GameState, prop: DeepPartial<T>): string {
        if (!state.getLastScene()) {
            throw new Error("No scene found in state, make sure you called \"scene.activate()\" before this method.");
        }
        const {invertY, invertX} = state.getLastScene().config || {};
        const Transforms = [
            `translate(${invertX ? "" : "-"}50%, ${invertY ? "" : "-"}50%)`,
            (prop["scale"] !== undefined) && `scale(${prop["scale"]})`,
            (prop["rotation"] !== undefined) && `rotate(${prop["rotation"]}deg)`,
        ];
        return Transforms.filter(Boolean).join(" ");
    }

    setControl(control: AnimationPlaybackControls) {
        this.control = control;
        return this;
    }

    getControl() {
        return this.control;
    }

    public copy(): Transform<T> {
        return new Transform<T>(this.sequences, this.sequenceOptions);
    }
}




