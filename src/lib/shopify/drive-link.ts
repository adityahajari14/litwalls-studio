import "server-only";

import { driveFolderUrl } from "@/lib/drive/naming";
import { admin } from "@/lib/shopify/admin";
import { ShopifyError } from "@/lib/shopify/storefront";

/**
 * The link from a Shopify product to its print files on Google Drive.
 *
 * Stored as a product metafield (custom.drive_folder, type url) rather than in
 * the description or a tag: it is for whoever fulfils an order, not for the
 * customer, and a metafield never reaches the storefront unless a theme asks
 * for it. The definition is pinned, so the link shows on the product page in
 * the Shopify admin — open the order, click the line item, and it is there.
 */

export const DRIVE_LINK_NAMESPACE = "custom";
export const DRIVE_LINK_KEY = "drive_folder";

const DEFINITION_CREATE = /* GraphQL */ `
  mutation DefineDriveLink($definition: MetafieldDefinitionInput!) {
    metafieldDefinitionCreate(definition: $definition) {
      createdDefinition {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const DEFINITION_PIN = /* GraphQL */ `
  mutation PinDriveLink($definitionId: ID!) {
    metafieldDefinitionPin(definitionId: $definitionId) {
      userErrors {
        field
        message
      }
    }
  }
`;

const METAFIELDS_SET = /* GraphQL */ `
  mutation SetDriveLink($metafields: [MetafieldsSetInput!]!) {
    metafieldsSet(metafields: $metafields) {
      metafields {
        id
      }
      userErrors {
        field
        message
        code
      }
    }
  }
`;

const holder = globalThis as typeof globalThis & {
  __litwallsDriveLinkDefined?: boolean;
};

/**
 * Create and pin the metafield definition, once per server run.
 *
 * Best-effort: a value can be written without a definition, it just is not
 * shown on the product page until one exists. So a failure here is logged and
 * the link is still saved, rather than holding up every poster over a display
 * setting. An existing definition is left exactly as it is — if someone has
 * unpinned or renamed it in the admin, that was on purpose.
 */
async function ensureDefinition(): Promise<void> {
  if (holder.__litwallsDriveLinkDefined) return;
  try {
    const data = await admin<{
      metafieldDefinitionCreate: {
        createdDefinition: { id: string } | null;
        userErrors: { field: string[] | null; message: string; code?: string }[];
      };
    }>(DEFINITION_CREATE, {
      definition: {
        name: "Drive folder",
        namespace: DRIVE_LINK_NAMESPACE,
        key: DRIVE_LINK_KEY,
        type: "url",
        ownerType: "PRODUCT",
        description:
          "Google Drive folder with this poster's print files. Filled in by Litwalls Studio.",
      },
    });
    const { createdDefinition, userErrors } = data.metafieldDefinitionCreate;
    const taken = userErrors.some((e) => e.code === "TAKEN");
    if (userErrors.length && !taken) {
      console.warn(
        `[drive-link] could not define the product metafield: ${userErrors
          .map((e) => e.message)
          .join("; ")}`,
      );
      return; // try again next time
    }
    if (createdDefinition) {
      const pinned = await admin<{
        metafieldDefinitionPin: { userErrors: { message: string }[] };
      }>(DEFINITION_PIN, { definitionId: createdDefinition.id });
      if (pinned.metafieldDefinitionPin.userErrors.length) {
        console.warn(
          `[drive-link] defined but could not pin: ${pinned.metafieldDefinitionPin.userErrors
            .map((e) => e.message)
            .join("; ")}`,
        );
      }
    }
    holder.__litwallsDriveLinkDefined = true;
  } catch (cause) {
    console.warn(
      `[drive-link] could not define the product metafield: ${
        cause instanceof Error ? cause.message : String(cause)
      }`,
    );
  }
}

/** Write (or overwrite) a product's Drive folder link. */
export async function setDriveLink(productId: string, folderId: string): Promise<void> {
  await ensureDefinition();

  const data = await admin<{
    metafieldsSet: {
      userErrors: { field: string[] | null; message: string; code?: string }[];
    };
  }>(METAFIELDS_SET, {
    metafields: [
      {
        ownerId: productId,
        namespace: DRIVE_LINK_NAMESPACE,
        key: DRIVE_LINK_KEY,
        type: "url",
        value: driveFolderUrl(folderId),
      },
    ],
  });

  const { userErrors } = data.metafieldsSet;
  if (userErrors.length) {
    throw new ShopifyError(userErrors.map((e) => e.message).join("; "), userErrors);
  }
}
