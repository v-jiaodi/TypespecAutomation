import { Page, _electron } from "playwright"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { test as baseTest, inject } from "vitest"
import screenshot from "screenshot-desktop"
import moment from "moment"
import { closeVscode } from "./commonSteps"

interface Context {
  page: Page
  extensionDir: string
}

type LaunchFixture = (options: {
  extensionPath?: string
  workspacePath: string
  trace?: "on" | "off"
}) => Promise<Context>

/**
 * The core method of the test, this method is encapsulated.
 * With the help of the `_electron` object, you can open a vscode and get the page object
 */
const test = baseTest.extend<{
  launch: LaunchFixture
}>({
  launch: async ({ }, use) => {
    let app: Awaited<ReturnType<typeof _electron.launch>> | undefined
    await use(async (options) => {
      const executablePath = inject("executablePath")
      const workspacePath = options.workspacePath
      let envOverrides = {}
      const codePath = path.join(executablePath, "../bin")
      envOverrides = {
        PATH: `${codePath}${path.delimiter}${process.env.PATH}`,
      }
      const tempDir = await fs.promises.mkdtemp(
        path.join(os.tmpdir(), "typespec-automation")
      )

      app = await _electron.launch({
        executablePath,
        env: {
          ...process.env,
          ...envOverrides,
        },
        args: [
          "--no-sandbox",
          "--disable-gpu-sandbox",
          "--disable-updates",
          "--skip-welcome",
          "--skip-release-notes",
          "--disable-workspace-trust",
          `--extensions-dir=${path.resolve(tempDir, "extensions")}`,
          `--user-data-dir=${path.resolve(tempDir, "user-data")}`,
          `--folder-uri=file:${path.resolve(workspacePath)}`,
        ].filter((v): v is string => !!v),
      })
      const page = await app.firstWindow()
      const userSettingsPath = path.join(
        tempDir,
        "user-data",
        "User",
        "settings.json"
      )
      fs.writeFileSync(
        userSettingsPath,
        JSON.stringify({
          "typespec.initTemplatesUrls": [
            {
              name: "Azure",
              url: "https://aka.ms/typespec/azure-init",
            },
          ],
        })
      )
      // spawn("code", [
      //   "--install-extension",
      //   path.resolve(__dirname, "../../extension.vsix"),
      //   "--extensions-dir",
      //   path.resolve(tempDir, "extensions"),
      // ])
      return { page, extensionDir: path.join(tempDir, "extensions") }
    })
    await app?.close()
  },
})

async function sleep(s: number) {
  return new Promise((resolve) => setTimeout(resolve, s * 1000))
}

/**
 * @param count Number of retries
 * @param fn Main process retry function, when this function returns true, retry ends
 * @param errMessage If the number of retries reaches 0, an error is thrown
 * @param gap
 * @returns Retry Interval
 */
async function retry(
  count: number,
  fn: () => Promise<boolean>,
  errMessage: string,
  gap: number = 2
) {
  while (count > 0) {
    await sleep(gap)
    if (await fn()) {
      return
    }
    count--
  }
  await screenShot.screenShot("error.png")
  screenShot.save()
  await closeVscode()
  throw new Error(errMessage)
}

/**
 * @description Screenshot class
 * @class Screenshot
 * @property {string} createType - createType: "create" | "emit" | "import"
 * @property {string} currentDir - currentDir: The directory where the screenshots are saved
 * @property {Array} fileList - fileList: Screenshot file list
 * @property {Object} typeMenu - typeMenu: Mapping of folder names corresponding to screenshot types
 * @property {boolean} isLocalSave - isLocalSave: Whether to save screenshots when running locally. Not saved by default, only saved on Ci
 * @method setCreateType - Set the screenshot type. Different types correspond to different folders.
 * @method setDir - Set the directory where the screenshots are saved. Each case has its own directory.
 * @method screenShot - Screenshot method
 */
class Screenshot {
  private createType: "create" | "emit" | "import" | "preview" = "create"
  private currentDir = ""
  private fileIndex = 0
  private typeMenu = {
    create: "CreateTypeSpecProject",
    emit: "EmitFromTypeSpec",
    import: "ImportTypeSpecFromOpenAPI3",
    preview: "PreviewAPIDocument",
  }

  setCreateType(createType: "create" | "emit" | "import" | "preview") {
    this.createType = createType
  }

  save() {
    // no-op: screenshots are written to disk immediately in screenShot()
  }

  async screenShot(fileName: string) {
    await sleep(3)
    const img = await screenshot()
    const rootDir =
      process.env.BUILD_ARTIFACT_STAGING_DIRECTORY ||
      path.resolve(__dirname, "../..")
    const platformDir = os.platform() === "win32" ? "/images-windows" : "/images-linux"
    const indexedFileName = `${this.fileIndex++}_${fileName}`
    const fullPath = path.join(
      rootDir,
      platformDir,
      this.typeMenu[this.createType],
      this.currentDir,
      indexedFileName
    )
    fs.mkdirSync(path.dirname(fullPath), { recursive: true })
    fs.writeFileSync(fullPath, Buffer.from(img))
  }

  setDir(dir: string) {
    this.currentDir = dir + moment().format("_HH_mm_ss")
    this.fileIndex = 0
  }

  getDir() {
    return this.typeMenu[this.createType] + "/" + this.currentDir
  }
}

const screenShot = new Screenshot()

export { sleep, test, retry, screenShot }
