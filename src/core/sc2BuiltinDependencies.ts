/** Native installation package profiles shared by document creation and mounted Data overlays. */
export const sc2BuiltinDependencies:Readonly<Record<string,readonly string[]>>={
 'mods/core.sc2mod':[], 'mods/liberty.sc2mod':['Mods/Core.SC2Mod'], 'mods/swarm.sc2mod':['Mods/Liberty.SC2Mod'], 'mods/void.sc2mod':['Mods/Swarm.SC2Mod'],
 'mods/libertymulti.sc2mod':['Mods/Liberty.SC2Mod'], 'mods/swarmmulti.sc2mod':['Mods/Swarm.SC2Mod','Mods/LibertyMulti.SC2Mod'], 'mods/voidmulti.sc2mod':['Mods/Void.SC2Mod','Mods/SwarmMulti.SC2Mod'],
 'campaigns/liberty.sc2campaign':['Mods/Liberty.SC2Mod'], 'campaigns/swarm.sc2campaign':['Mods/Swarm.SC2Mod','Campaigns/Liberty.SC2Campaign'], 'campaigns/void.sc2campaign':['Mods/Void.SC2Mod','Campaigns/Swarm.SC2Campaign'],
};
