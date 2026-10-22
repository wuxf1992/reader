ARG READER_IMAGE=reader-github:main-875fec84-custom
FROM ${READER_IMAGE}

# Service implementations are installed with the plugin; this image supplies runtimes.
COPY entrypoint.sh supervisor.mjs service-host.mjs healthcheck.mjs /all-in-one/
RUN chmod 0755 /all-in-one/entrypoint.sh \
 && addgroup -g 1001 browser && adduser -D -H -u 1001 -G browser browser

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
 CMD node /all-in-one/healthcheck.mjs
ENTRYPOINT ["/all-in-one/entrypoint.sh"]
CMD ["node", "dist/main.js"]
