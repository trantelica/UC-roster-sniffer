export interface District {
  districtId: string;
  name: string;
  mascot: string;
  logoAssetPath: string;
  helmetAssetPath: string;
  primaryColor: string;
  secondaryColor: string;
}

export interface AgeDivision {
  ageDivisionId: string;
  name: string;
  leagueLabel: string;
  ordinal: number;
  typicalAges: number[];
}

export interface Player {
  name: string;
  notes?: string;
}

export interface Coach {
  name: string;
}

export interface Team {
  teamId: string;
  seasonId: string;
  districtId: string;
  ageDivisionId: string;
  teamCode: string;
  draftOrder: number;
  divisionTeamCount: number;
  headCoach: Coach | null;
  assistantCoaches: Coach[];
  players: Player[];
}

export interface AppData {
  districts: District[];
  ageDivisions: AgeDivision[];
  teams: Team[];
}
