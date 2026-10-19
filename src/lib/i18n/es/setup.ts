import type { SameShape } from "../shape";

/** Mirrors `src/lib/i18n/en/setup.ts`; every key added there must be translated here. */
export const setup: SameShape<(typeof import("../en/setup"))["setup"]> = {
  modes: {
    connect: {
      button: "Conectar un repositorio",
      heading: "Conectar el repositorio de tu equipo",
      descriptionBefore: "GitTeam guarda una copia local en",
      descriptionAfter: "y la mantiene sincronizada.",
      repositoryLabel: "URL del repositorio",
    },
    create: {
      button: "Crear un tablero",
      heading: "Crear un tablero",
      description:
        "GitTeam crea un repositorio privado en GitHub que solo contiene tickets. Compartir un tablero es compartir ese repositorio, así que el repositorio que contiene tu código nunca interviene.",
      boardNameLabel: "Nombre del tablero",
      boardNamePlaceholder: "tablero-de-mi-equipo",
      suggestedBoardName: (projectName: string) => `${projectName}-tablero`,
    },
    join: {
      button: "Unirse a un tablero",
      heading: "Unirse a un tablero",
      description:
        "Pega la invitación que te enviaron. GitTeam te muestra a qué tablero pertenece antes de clonar nada.",
      invitationLabel: "Enlace de invitación",
      accessHint:
        "Tu acceso lo tiene que otorgar quien te invitó: el enlace no es una clave y el tablero es privado. Si ya te lo otorgó por nombre de usuario, GitTeam te ofrece aceptar la invitación aquí.",
    },
  },

  invite: {
    board: "Tablero",
    unnamedBoard: "Un tablero",
    invitedBy: (name: string) => ` · invitación de ${name}`,
  },

  token: {
    label: "Token de acceso personal",
    optionalLabel: "Token de acceso personal (opcional)",
    inheritedHint:
      "Déjalo vacío para reutilizar el token ya guardado para este proyecto.",
    joinHint:
      "El tablero es privado, así que se clona con tu propio acceso a GitHub: el mismo token que usarías para clonarlo a mano.",
    scopeHintBefore:
      "GitHub → Configuración → Configuración de desarrollador → Tokens de acceso personal (clásico, con el permiso",
    scopeHintAfter: ")",
  },

  identity: {
    nameLabel: "Nombre de usuario de Git",
    namePlaceholder: "Carlos Pérez",
    emailLabel: "Correo del usuario de Git",
    emailPlaceholder: "carlos@example.com",
    inheritedHint:
      "Deja el nombre y el correo vacíos para reutilizar los ya guardados para este proyecto.",
  },

  pending: {
    holding: "GitHub tiene una invitación para ti en",
    sentBy: (name: string) => ` · enviada por ${name}`,
    after: ". Un tablero privado se clona una vez que la aceptas.",
    accept: "Aceptar y unirme",
  },

  actions: {
    submitConnect: "Probar y conectar",
    submitCreate: "Crear tablero",
    submitCheckLink: "Comprobar enlace",
    submitJoin: "Unirme a este tablero",
    busyCreate: "Creando…",
    busyChecking: "Comprobando…",
    busyConnect: "Probando y conectando…",
    back: "Volver a mi tablero",
  },

  errors: {
    invitationRequired: "Pega el enlace de invitación que te enviaron.",
    connectFailed: "No se pudo conectar con el repositorio.",
    allFieldsRequired: "Todos los campos son obligatorios.",
    createCredentialsRequired:
      "Se necesitan un token, un nombre de usuario de Git y un correo de usuario de Git para crear el primer tablero.",
    joinCredentialsRequired:
      "Se necesitan tu propio token, tu nombre y tu correo: un tablero privado se clona con tus credenciales.",
  },

  toasts: {
    connected: (repo: string) => `Conectado a ${repo}`,
    invitationAccepted: "Invitación aceptada",
    created: (name: string) => `Se creó ${name}`,
  },
};
