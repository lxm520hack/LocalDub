import { Play, Pause } from "lucide-solid";
import { srtTime } from "@repo/core/utils/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@repo/ui-solid/base/select";

interface Props {
  playing: boolean;
  currentTime: number;
  duration: number;
  playbackRate: number;
  onTogglePlay: () => void;
  onRateChange: (rate: number) => void;
}

const rateValues = ["0.5", "0.75", "1", "1.25", "1.5", "2"];
const rateLabel = (v: string) => `${v}x`;

export function VideoControls(props: Props) {
  return (
    <div class="flex items-center h-10 px-3 gap-3 bg-muted/20 border-t text-sm select-none">
      <span class="text-xs text-muted-foreground  tabular-nums">
        {srtTime(props.currentTime, '.')} / {srtTime(props.duration, '.')}
      </span>

      <div class="flex-1 flex justify-center">
        <button
          onClick={props.onTogglePlay}
          class="flex items-center justify-center w-8 h-8 rounded hover:bg-accent/50"
        >
          {props.playing ? <Pause size={16} /> : <Play size={16} />}
        </button>
      </div>

      <Select<string>
        options={rateValues}
        value={String(props.playbackRate)}
        onChange={(v) => props.onRateChange(Number(v))}
        placeholder="1"
        itemComponent={(p) => (
          <SelectItem item={p.item}>{rateLabel(p.item.rawValue)}</SelectItem>
        )}
      >
        <SelectTrigger class="w-14 h-7 text-xs">
          <SelectValue<string>>{(state) => rateLabel(state.selectedOption())}</SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
    </div>
  );
}
