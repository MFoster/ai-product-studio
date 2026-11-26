FROM node:22.18.0-bookworm-slim AS manifests
WORKDIR /opt/aps
ENV NEXT_TELEMETRY_DISABLED=1
COPY package.json package-lock.json ./
COPY apps/aps_cli/package.json apps/aps_cli/package.json
COPY apps/engineer_ui/package.json apps/engineer_ui/package.json

FROM manifests AS toolchain-build
RUN npm ci
COPY apps/aps_cli/bin apps/aps_cli/bin
COPY apps/aps_cli/src apps/aps_cli/src
COPY apps/aps_cli/schema apps/aps_cli/schema
COPY apps/engineer_ui apps/engineer_ui
COPY scripts/build-toolchain.mjs scripts/build-toolchain.mjs
COPY .github/agents .github/agents
COPY .github/skills .github/skills
COPY .github/instructions .github/instructions
COPY .specify .specify
COPY template template
COPY README.md LICENSE ./
RUN npm run build:toolchain

FROM manifests AS dependencies
RUN npm ci --omit=dev --workspace=@mfoster/ai-product-studio

FROM node:22.18.0-bookworm-slim AS cli
WORKDIR /opt/aps
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 APS_STUDIO_ROOT=/studio
COPY --from=dependencies --chown=node:node /opt/aps/ /opt/aps/
COPY --from=toolchain-build --chown=node:node /opt/aps/apps/aps_cli/bin/ apps/aps_cli/bin/
COPY --from=toolchain-build --chown=node:node /opt/aps/apps/aps_cli/src/ apps/aps_cli/src/
COPY --from=toolchain-build --chown=node:node /opt/aps/apps/aps_cli/schema/ apps/aps_cli/schema/
COPY --from=toolchain-build --chown=node:node /opt/aps/apps/aps_cli/capabilities/ apps/aps_cli/capabilities/
USER node
WORKDIR /studio
ENTRYPOINT ["node", "/opt/aps/apps/aps_cli/bin/aps-node.js"]

FROM cli AS ui
COPY --from=toolchain-build --chown=node:node /opt/aps/apps/aps_cli/dist/ui/ /opt/aps/apps/aps_cli/dist/ui/
EXPOSE 3000
ENTRYPOINT ["node", "/opt/aps/apps/aps_cli/bin/aps-ui.js"]
CMD ["--hostname", "0.0.0.0"]
