# Make sure you setup emscripten first:
#
# source /path/to/emsdk/emsdk_env.sh
#
# Then make with:
#
# emmake make

OUTPUTS = webm-muxer.js webm-muxer.wasm
WEBM_TOOLS = webm-tools/shared
SOURCES_CC = webm-muxer.cc $(WEBM_TOOLS)/webm_live_muxer.cc $(WEBM_TOOLS)/webm_chunk_writer.cc
HEADERS = $(WEBM_TOOLS)/webm_live_muxer.h
LIBRARY_JS = library.js
LIBWEBM = libwebm_build/libwebm.a

all: $(OUTPUTS)

$(OUTPUTS): $(SOURCES_CC) $(LIBRARY_JS) $(LIBWEBM) $(HEADERS) Makefile
	$(CXX) \
		-O3 \
		--closure 1 \
		--std=c++17 \
		-Iwebm-tools/shared \
		-Ilibwebm \
		-Llibwebm_build \
		-Wall \
		-s ASSERTIONS=0 \
		-s EXIT_RUNTIME=1 \
		-s TOTAL_MEMORY=67108864 \
		-s ALLOW_MEMORY_GROWTH \
		-s ASYNCIFY \
		-s 'ASYNCIFY_IMPORTS=["emscripten_read_async"]' \
		--js-library $(LIBRARY_JS) \
		-o $@ \
		$(SOURCES_CC) \
		-lwebm

$(LIBWEBM): libwebm_build/Makefile
	cd libwebm_build && emmake make

libwebm_build/Makefile: libwebm
	mkdir -p libwebm_build && cd libwebm_build && emcmake cmake ../libwebm

clean:
	rm -rf $(OUTPUTS) libwebm_build
