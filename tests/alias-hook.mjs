/**
 * Teach `node --test` the "@/" path alias.
 *
 * Next resolves "@/lib/..." through tsconfig `paths`, but plain Node knows
 * nothing about tsconfig — it sees a bare specifier and goes looking for a
 * package called "@". Without this, any module in src/ that imports a sibling
 * is untestable, which would push the pure logic towards relative paths purely
 * to satisfy the test runner. That is the tail wagging the dog.
 *
 * Node's `imports` field cannot help: it only maps specifiers beginning "#".
 * A resolver hook is the supported mechanism.
 *
 * Registered via --import in the test script.
 */
import { register } from "node:module";

register("./alias-resolver.mjs", import.meta.url);
