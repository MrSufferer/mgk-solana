import { AdapterMode } from "@/adapter/types";
import { useGlobalStore } from "@/stores/store";
import LockedIcon from "@carbon/icons-react/lib/Locked";
import UnlockedIcon from "@carbon/icons-react/lib/Unlocked";
import { SidebarTab } from "./SidebarTab";

interface Props {
  className?: string;
}

export function ModeToggle(props: Props) {
  const adapterMode = useGlobalStore((state) => state.adapterMode);
  const setAdapterMode = useGlobalStore((state) => state.setAdapterMode);

  return (
    <div className={props.className}>
      <div className="mb-2 text-xs text-zinc-400">Trading Mode</div>
      <div className="grid grid-cols-2 gap-x-1 rounded bg-black p-1">
        <SidebarTab
          selected={adapterMode === AdapterMode.Private}
          onClick={() => setAdapterMode(AdapterMode.Private)}
        >
          <LockedIcon className="h-4 w-4" />
          <div>Private</div>
        </SidebarTab>
        <SidebarTab
          selected={adapterMode === AdapterMode.Public}
          onClick={() => setAdapterMode(AdapterMode.Public)}
        >
          <UnlockedIcon className="h-4 w-4" />
          <div>Public</div>
        </SidebarTab>
      </div>
      <p className="mt-2 text-xs text-zinc-500">
        {adapterMode === AdapterMode.Private
          ? "Encrypted MPC-based trading (Arcium)"
          : "Public non-encrypted trading"}
      </p>
    </div>
  );
}

