import { useMemo } from "react";
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { getEquipment, type EquipmentProfile } from "brewdio-wasm";
import { getBackend } from "./app-db";
import { equipmentKeys } from "./query-keys";

export { equipmentKeys };

export function useEquipmentProfiles() {
  const builtInProfiles = useMemo(() => getEquipment(), []);

  return useQuery<EquipmentProfile[]>({
    queryKey: equipmentKeys.all,
    queryFn: async () => {
      const storedProfiles = await getBackend().listEquipmentProfiles();
      const builtInIds = new Set(builtInProfiles.map((profile) => profile.id));

      return [
        ...builtInProfiles,
        ...storedProfiles.filter((profile) => !builtInIds.has(profile.id)),
      ];
    },
    placeholderData: builtInProfiles,
  });
}

export async function createEquipmentProfileImperative(
  profile: EquipmentProfile
): Promise<string> {
  return getBackend().createEquipmentProfile(profile);
}

export async function updateEquipmentProfileImperative(
  id: string,
  profile: EquipmentProfile
): Promise<void> {
  return getBackend().updateEquipmentProfile(id, profile);
}

export async function deleteEquipmentProfileImperative(id: string): Promise<void> {
  return getBackend().deleteEquipmentProfile(id);
}

export async function invalidateEquipmentProfiles(queryClient: QueryClient) {
  await queryClient.invalidateQueries({ queryKey: equipmentKeys.all });
}
